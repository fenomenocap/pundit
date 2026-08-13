import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

const MAX_PAGES = 3;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_TEXT_CHARS = 16_000;

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

export interface RetrievalOptions {
  fetch?: FetchPage;
  resolveHost?: ResolveHost;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxTextChars?: number;
  now?: () => Date;
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
  if (url.username || url.password || url.port) throw new Error("URL credentials and custom ports are not allowed");
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
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("evidence page exceeded size limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error("evidence page exceeded size limit");
    }
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
      headers: { accept: "text/html, text/plain;q=0.9" },
      redirect: "manual",
      signal,
    }, resolved.addresses[0]);
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
    if (redirected.url.hostname.toLocaleLowerCase() !== url.hostname.toLocaleLowerCase()) {
      throw new Error("cross-host evidence redirect blocked");
    }
    resolved = redirected;
    url = redirected.url;
  }
  if (!response?.ok) throw new Error(`evidence page returned status ${response?.status ?? 0}`);
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("unsupported evidence content type");
  }
  const raw = await readBoundedBody(response, options.maxResponseBytes);
  const text = plainTextFromPage(raw, contentType, options.maxTextChars);
  if (!text) throw new Error("evidence page contained no readable text");
  return { ...candidate, finalUrl: url.toString(), text, retrievedAt: options.now().toISOString() };
}

/**
 * Selectively retrieves no more than three pages, preferring official and then
 * reputable sources. Individual failures are omitted; an aborted shared request
 * is propagated so retrieval cannot outlive the API's global deadline.
 */
export async function retrieveEvidencePages(
  candidates: readonly EvidencePageCandidate[],
  signal?: AbortSignal,
  options: RetrievalOptions = {}
): Promise<RetrievedEvidencePage[]> {
  const rank: Record<EvidenceAuthority, number> = { official: 0, reputable: 1, other: 2 };
  const selected = [...candidates]
    .filter((candidate) =>
      candidate.id.trim()
      && candidate.url.trim()
      && (candidate.authority === "official" || candidate.authority === "reputable")
    )
    .sort((a, b) => rank[a.authority] - rank[b.authority])
    .filter((candidate, index, all) => all.findIndex((entry) => entry.url === candidate.url) === index)
    .slice(0, MAX_PAGES);
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
      return await retrieveOne(candidate, signal, resolved);
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
  }));
  return settled.filter((page): page is RetrievedEvidencePage => page !== null);
}
