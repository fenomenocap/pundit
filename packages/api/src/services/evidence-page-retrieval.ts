import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

// Three pages against a bundle of thirty sources meant verification usually
// ran on one fetched page: claims citing anything else could not be supported,
// and the same question answered with cited team news or an abstention
// depending on which page won the slice. Fetches run in parallel under a 6s
// timeout, so widening this costs little wall clock.
const MAX_PAGES = 8;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_TEXT_CHARS = 16_000;
// Identified client, matching `elo-ratings.ts`. CloudFront returns 503 on
// premierleague.com when the pinned request has no User-Agent at all; a
// browser UA is not required.
const EVIDENCE_USER_AGENT = "Mozilla/5.0 (compatible; pundit/1.0)";

export type EvidenceAuthority = "official" | "reputable" | "other";

export interface EvidencePageCandidate {
  id: string;
  url: string;
  title: string;
  date: string;
  authority: EvidenceAuthority;
}

export interface RetrievedEvidencePage extends EvidencePageCandidate {
  finalUrl: string;
  text: string;
  retrievedAt: string;
}

type AddressRecord = { address: string; family: number };
type ResolveHost = (hostname: string, signal?: AbortSignal) => Promise<AddressRecord[]>;
type FetchPage = (input: string | URL, init?: RequestInit, address?: AddressRecord) => Promise<Response>;

/**
 * Just the fetched body, with no candidate identity attached.
 *
 * The cache is deliberately keyed on the URL and stores only what came back
 * over the wire. Caching a whole `RetrievedEvidencePage` would carry the id,
 * title and authority of whichever candidate happened to warm the entry, and a
 * later consumer would silently inherit them -- which is how a citation ends up
 * naming one source and quoting another.
 */
interface FetchedPageBody {
  finalUrl: string;
  text: string;
  retrievedAt: string;
  /**
   * Publication date recovered from the page itself. Empty when the HTML had
   * no usable `datePublished`. The provider date is merged on later, so an
   * empty value here must not overwrite a search-result date.
   */
  date: string;
}

/**
 * Page bodies for one request, shared between a prefetch started early and the
 * retrieval that later needs them. Scoped to a request rather than the process
 * so nothing is served across users or outlives its evidence.
 */
export type EvidencePageCache = Map<string, Promise<FetchedPageBody | null>>;

export function createEvidencePageCache(): EvidencePageCache {
  return new Map();
}

export interface RetrievalOptions {
  fetch?: FetchPage;
  resolveHost?: ResolveHost;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxTextChars?: number;
  now?: () => Date;
  cache?: EvidencePageCache;
}

function hasDisallowedPort(url: URL): boolean {
  if (!url.port) return false;
  if (url.protocol === "https:" && url.port === "443") return false;
  if (url.protocol === "http:" && url.port === "80") return false;
  return true;
}

/**
 * Apex and `www.` of the same host are one publisher. Search results and
 * Location headers mix them constantly (`premierleague.com` →
 * `www.premierleague.com:443/`); treating that as a cross-host open redirect
 * dropped the official page. `news.bbc.co.uk` vs `www.bbc.co.uk` still fails.
 */
export function sameEvidenceHost(left: string, right: string): boolean {
  const normalize = (host: string) => host.toLocaleLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return normalize(left) === normalize(right);
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : null;
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.trim().toLocaleLowerCase().split("%")[0];
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  const ipv4 = parseIpv4(mapped?.[1] ?? normalized);
  if (ipv4) {
    const [a, b] = ipv4;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (isIP(normalized) === 6) {
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("ff");
  }
  return true;
}

async function defaultResolveHost(hostname: string, signal?: AbortSignal): Promise<AddressRecord[]> {
  const resolution = lookup(hostname, { all: true, verbatim: true });
  if (!signal) return resolution;
  if (signal.aborted) throw signal.reason;
  return Promise.race([
    resolution,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);
}

async function assertPublicHttpUrl(
  raw: string,
  resolveHost: ResolveHost,
  signal: AbortSignal
): Promise<{ url: URL; addresses: AddressRecord[] }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid evidence URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported URL scheme");
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  if (hasDisallowedPort(url)) throw new Error("custom ports are not allowed");
  const hostname = url.hostname.toLocaleLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("local evidence URL blocked");
  }
  const literalFamily = isIP(hostname);
  if (literalFamily && isPrivateOrReservedAddress(hostname)) throw new Error("private evidence address blocked");
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveHost(hostname, signal);
  if (!addresses.length || addresses.some((record) => isPrivateOrReservedAddress(record.address))) {
    throw new Error("evidence host did not resolve exclusively to public addresses");
  }
  return { url, addresses };
}

/** Connects to the already validated address while retaining Host/SNI. */
async function fetchPinned(
  input: string | URL,
  init: RequestInit = {},
  address?: AddressRecord
): Promise<Response> {
  const url = new URL(input);
  if (!address) throw new Error("validated evidence address missing");
  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.protocol === "https:" ? 443 : 80,
      method: init.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      headers: { host: url.hostname, ...(init.headers as Record<string, string> | undefined) },
      ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
      signal: init.signal ?? undefined,
    }, (incoming) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
        else if (value !== undefined) headers.set(name, value);
      }
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream, {
        status: incoming.statusCode ?? 500,
        statusText: incoming.statusMessage,
        headers,
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  // Modern news pages are often 0.8–1.5MB. Dates live in the first kilobytes
  // and verification only keeps 16KB of text, so a hard reject on
  // Content-Length (BBC, Guardian, club sites) was discarding usable pages.
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - received;
    if (remaining <= 0) {
      await reader.cancel();
      break;
    }
    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining));
      received += remaining;
      await reader.cancel();
      break;
    }
    received += value.byteLength;
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function usablePublicationDate(raw: string, now: Date): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const publishedAt = Date.parse(trimmed);
  if (!Number.isFinite(publishedAt)) return "";
  if (publishedAt > now.getTime()) return "";
  return trimmed;
}

function jsonLdDatePublished(value: unknown, now: Date): string {
  if (typeof value === "string") return usablePublicationDate(value, now);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = jsonLdDatePublished(entry, now);
      if (found) return found;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (record["@graph"]) {
    const found = jsonLdDatePublished(record["@graph"], now);
    if (found) return found;
  }
  // Ignore dateModified: it launders old copy into the recency window.
  const published = record.datePublished;
  if (typeof published === "string") {
    const found = usablePublicationDate(published, now);
    if (found) return found;
  } else if (published && typeof published === "object" && !Array.isArray(published)) {
    const nested = (published as Record<string, unknown>)["@value"];
    if (typeof nested === "string") {
      const found = usablePublicationDate(nested, now);
      if (found) return found;
    }
  }
  for (const nested of Object.values(record)) {
    if (!nested || typeof nested !== "object") continue;
    const found = jsonLdDatePublished(nested, now);
    if (found) return found;
  }
  return "";
}

function attrValue(tag: string, name: string): string {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag);
  if (quoted?.[1]) return quoted[1];
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
  return bare?.[1] ?? "";
}

function extractJsonLdPublished(html: string, now: Date): string {
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(match[1] ?? "")) continue;
    try {
      const parsed: unknown = JSON.parse((match[2] ?? "").trim());
      const found = jsonLdDatePublished(parsed, now);
      if (found) return found;
    } catch {
      // Malformed JSON-LD is not a publication date.
    }
  }
  return "";
}

function extractMetaPublished(html: string, now: Date): string {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  const pick = (test: (tag: string) => boolean): string => {
    for (const tag of tags) {
      if (!test(tag)) continue;
      const found = usablePublicationDate(attrValue(tag, "content"), now);
      if (found) return found;
    }
    return "";
  };
  return pick((tag) =>
    /(?:property|name)\s*=\s*["']article:published_time["']/i.test(tag)
  )
    || pick((tag) => /name\s*=\s*["']pubdate["']/i.test(tag))
    || pick((tag) => /itemprop\s*=\s*["']datePublished["']/i.test(tag));
}

function extractTimePublished(html: string, now: Date): string {
  for (const match of html.matchAll(/<time\b[^>]*>/gi)) {
    const found = usablePublicationDate(attrValue(match[0], "datetime"), now);
    if (found) return found;
  }
  return "";
}

/**
 * Publication date from raw HTML, before tags are stripped. Preference:
 * JSON-LD `datePublished`, then article/pubdate meta, then `<time datetime>`.
 * `dateModified` is ignored. Unparseable and future dates are rejected.
 */
export function extractPublicationDate(raw: string, now: Date): string {
  return extractJsonLdPublished(raw, now)
    || extractMetaPublished(raw, now)
    || extractTimePublished(raw, now);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A calendar date written into a search snippet or title, used when the HTML
 * fetch fails and the provider `date` field is empty. ISO dates first, then a
 * day-month-year or month-day-year with an English month name. Bare years and
 * season labels (`2026/27`) are ignored.
 */
export function extractPlainTextPublicationDate(text: string, now: Date): string {
  const iso = /\b(20\d{2}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)\b/.exec(text);
  if (iso?.[1]) {
    const found = usablePublicationDate(iso[1], now);
    if (found) return found;
  }
  const written = text.match(
    /\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?,?\s+20\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+20\d{2})\b/i
  );
  if (!written?.[1]) return "";
  const parsed = Date.parse(written[1]);
  if (!Number.isFinite(parsed) || parsed > now.getTime()) return "";
  const date = new Date(parsed);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function usableEvidenceKind(raw: string, contentType: string): "html" | "text" | null {
  const ct = contentType.toLocaleLowerCase();
  if (ct.includes("text/html") || ct.includes("application/xhtml+xml")) return "html";
  if (ct.includes("text/plain")) return "text";
  if (!ct.trim() && /^\s*</.test(raw)) return "html";
  return null;
}

function evidenceLogUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function logEvidenceFetchFailure(url: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = /status (\d+)/i.exec(message);
  let reason = "error";
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    reason = status >= 400 ? "publisher_http" : status === 202 || status === 203 ? "publisher_challenge" : "http_status";
  }
  else if (/content type/i.test(message)) reason = "unsupported_content_type";
  else if (/cross-host/i.test(message)) reason = "cross_host_redirect";
  else if (/too many evidence redirects/i.test(message)) reason = "too_many_redirects";
  else if (/no readable text/i.test(message)) reason = "empty_body";
  else if (/timeout|aborted/i.test(message) || (error instanceof Error && error.name === "TimeoutError")) {
    reason = "timeout";
  } else if (/private|local evidence|public addresses/i.test(message)) reason = "ssrf_blocked";
  else if (/custom ports|credentials|unsupported URL scheme|invalid evidence URL/i.test(message)) {
    reason = "disallowed_url";
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) reason = "dns";
  else if (/cert|SSL|TLS|UNABLE_TO_VERIFY/i.test(message)) reason = "tls";
  else if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/i.test(message)) reason = "network";
  console.warn(JSON.stringify({
    event: "evidence_page_fetch_failed",
    url: evidenceLogUrl(url),
    reason,
    ...(statusMatch ? { status: Number(statusMatch[1]) } : {}),
  }));
}

function pinAddress(addresses: AddressRecord[]): AddressRecord {
  return addresses.find((record) => record.family === 4) ?? addresses[0];
}

function plainTextFromPage(raw: string, contentType: string, maxChars: number): string {
  const withoutNonContent = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  const text = contentType.includes("html")
    ? withoutNonContent.replace(/<[^>]+>/g, " ")
    : withoutNonContent;
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

async function retrieveOne(
  candidate: EvidencePageCandidate,
  requestSignal: AbortSignal | undefined,
  options: Required<Pick<RetrievalOptions, "timeoutMs" | "maxResponseBytes" | "maxTextChars" | "now">>
    & { fetch: FetchPage; resolveHost: ResolveHost }
): Promise<RetrievedEvidencePage> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  let resolved = await assertPublicHttpUrl(candidate.url, options.resolveHost, signal);
  let { url } = resolved;
  let response: Response | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (signal.aborted) throw signal.reason;
    response = await options.fetch(url, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": EVIDENCE_USER_AGENT,
      },
      redirect: "manual",
      signal,
    }, pinAddress(resolved.addresses));
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects === MAX_REDIRECTS) throw new Error("too many evidence redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("evidence redirect missing location");
    const redirected = await assertPublicHttpUrl(
      new URL(location, url).toString(),
      options.resolveHost,
      signal
    );
    // The evidence ID, authority and rendered citation belong to the searched
    // host. Following it to another host would verify one body while citing a
    // different source (and can turn an official-domain open redirect into
    // false official provenance), so cross-host redirects fail closed.
    // Apex ↔ www of the same host is the same publisher, not an open redirect.
    if (!sameEvidenceHost(redirected.url.hostname, url.hostname)) {
      throw new Error("cross-host evidence redirect blocked");
    }
    resolved = redirected;
    url = redirected.url;
  }
  // 202/403/503 from CDNs are publisher blocks, not "ok enough". `response.ok`
  // would have accepted ESPN's 202 challenge page as evidence.
  if (response?.status !== 200) throw new Error(`evidence page returned status ${response?.status ?? 0}`);
  const raw = await readBoundedBody(response, options.maxResponseBytes);
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
  const kind = usableEvidenceKind(raw, contentType);
  if (!kind) throw new Error("unsupported evidence content type");
  const extractedDate = kind === "html" ? extractPublicationDate(raw, options.now()) : "";
  const text = plainTextFromPage(raw, kind === "html" ? "text/html" : "text/plain", options.maxTextChars);
  if (!text) throw new Error("evidence page contained no readable text");
  return {
    ...candidate,
    date: extractedDate,
    finalUrl: url.toString(),
    text,
    retrievedAt: options.now().toISOString(),
  };
}

/**
 * Which candidates are worth a fetch, in the order they will be attempted.
 * Shared by retrieval and the prefetch so the two cannot select different
 * pages -- a prefetch that warmed the wrong URLs would be pure cost.
 */
function selectRetrievable(
  candidates: readonly EvidencePageCandidate[]
): EvidencePageCandidate[] {
  const rank: Record<EvidenceAuthority, number> = { official: 0, reputable: 1, other: 2 };
  return [...candidates]
    .filter((candidate) =>
      candidate.id.trim()
      && candidate.url.trim()
      && (candidate.authority === "official" || candidate.authority === "reputable")
    )
    .sort((a, b) => rank[a.authority] - rank[b.authority])
    .filter((candidate, index, all) => all.findIndex((entry) => entry.url === candidate.url) === index)
    .slice(0, MAX_PAGES);
}

export async function retrieveEvidencePages(
  candidates: readonly EvidencePageCandidate[],
  signal?: AbortSignal,
  options: RetrievalOptions = {}
): Promise<RetrievedEvidencePage[]> {
  const selected = selectRetrievable(candidates);
  const resolved = {
    fetch: options.fetch ?? fetchPinned,
    resolveHost: options.resolveHost ?? defaultResolveHost,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    maxTextChars: options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS,
    now: options.now ?? (() => new Date()),
  };
  const settled = await Promise.all(selected.map(async (candidate) => {
    try {
      const body = await bodyFor(candidate, signal, resolved, options.cache);
      if (!body) return null;
      const now = resolved.now();
      const pageDate = usablePublicationDate(body.date, now);
      const providerDate = usablePublicationDate(candidate.date, now);
      return { ...candidate, ...body, date: pageDate || providerDate };
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
  }));
  return settled.filter((page): page is RetrievedEvidencePage => page !== null);
}

/**
 * One fetch per URL per request. A cache hit is the whole point of the
 * prefetch: an entry warmed while the model was still writing is already
 * settled by the time verification asks for it.
 */
function bodyFor(
  candidate: EvidencePageCandidate,
  signal: AbortSignal | undefined,
  resolved: Required<Pick<RetrievalOptions, "timeoutMs" | "maxResponseBytes" | "maxTextChars" | "now">>
    & { fetch: FetchPage; resolveHost: ResolveHost },
  cache: EvidencePageCache | undefined
): Promise<FetchedPageBody | null> {
  if (!cache) return retrieveBody(candidate, signal, resolved);
  const key = candidate.url;
  const existing = cache.get(key);
  if (existing) return existing;
  // Stored as a promise, not a value, so two callers racing for the same URL
  // share one fetch instead of both going out.
  const pending = retrieveBody(candidate, signal, resolved).catch((error) => {
    if (signal?.aborted) throw error;
    return null;
  });
  cache.set(key, pending);
  return pending;
}

async function retrieveBody(
  candidate: EvidencePageCandidate,
  signal: AbortSignal | undefined,
  resolved: Required<Pick<RetrievalOptions, "timeoutMs" | "maxResponseBytes" | "maxTextChars" | "now">>
    & { fetch: FetchPage; resolveHost: ResolveHost }
): Promise<FetchedPageBody> {
  try {
    const page = await retrieveOne(candidate, signal, resolved);
    return {
      finalUrl: page.finalUrl,
      text: page.text,
      retrievedAt: page.retrievedAt,
      date: page.date,
    };
  } catch (error) {
    if (!signal?.aborted) logEvidenceFetchFailure(candidate.url, error);
    throw error;
  }
}

/**
 * Warms the cache for the pages verification is going to want, without waiting
 * for them.
 *
 * Retrieval sits behind answer generation on the critical path, and every page
 * it needs is already known from the evidence bundle -- only the *order* of the
 * candidates depends on what the model ends up citing, and ordering cannot
 * change what a URL returns. So the fetches can run while the model writes, and
 * verification finds them settled. The selection here deliberately mirrors
 * `retrieveEvidencePages` so the same pages are warmed that would be requested.
 *
 * Never rejects and never throws into the caller: a prefetch that fails just
 * leaves retrieval to fetch normally, exactly as it does today.
 *
 * It is speculative, and the cost of that was measured rather than assumed.
 * When an answer cites nothing, `verifyCurrentClaims` returns before it asks
 * for a page, so these fetches are spent for nothing. Across the 2026-08-25
 * evaluation that was 1 of 10 researched turns; the other 9 would have made
 * the identical requests a few seconds later. Bounded to `MAX_PAGES` hosts
 * already on the evidence allowlist, that is a trade worth taking for removing
 * the fetch from the critical path -- but it is a trade, not a free win.
 */
export function prefetchEvidencePages(
  candidates: readonly EvidencePageCandidate[],
  signal: AbortSignal | undefined,
  cache: EvidencePageCache,
  options: RetrievalOptions = {}
): void {
  const resolved = {
    fetch: options.fetch ?? fetchPinned,
    resolveHost: options.resolveHost ?? defaultResolveHost,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    maxTextChars: options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS,
    now: options.now ?? (() => new Date()),
  };
  for (const candidate of selectRetrievable(candidates)) {
    // Kicked off, deliberately not awaited. The catch keeps a failed prefetch
    // from surfacing as an unhandled rejection on a path nobody is awaiting.
    void bodyFor(candidate, signal, resolved, cache)?.catch(() => undefined);
  }
}
