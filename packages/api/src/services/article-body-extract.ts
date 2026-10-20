import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { plainTextFromPage } from "./html-plain-text";

export type ArticleBodySource = "json-ld-articleBody" | "article-main" | "readability";

export interface ExtractedArticleBody {
  text: string;
  headline: string;
  source: ArticleBodySource;
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"");
}

function extractJsonLdArticleBody(raw: string): string | null {
  const scripts = raw.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of scripts) {
    const inner = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(block)?.[1]?.trim();
    if (!inner) continue;
    try {
      const parsed = JSON.parse(inner) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const body = (node as { articleBody?: unknown }).articleBody;
        if (typeof body === "string" && body.trim().length >= 80) {
          return decodeBasicHtmlEntities(body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return null;
}

function extractHeadlineFromHtml(raw: string, document: Document): string {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(raw)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(raw);
  if (og?.[1]) return decodeBasicHtmlEntities(og[1].trim());
  const h1 = document.querySelector("article h1, main h1, h1");
  if (h1?.textContent?.trim()) return decodeBasicHtmlEntities(h1.textContent.trim());
  const title = document.querySelector("title")?.textContent?.trim();
  return title ? decodeBasicHtmlEntities(title) : "";
}

function extractArticleMainText(document: Document): string | null {
  const root = document.querySelector("article") ?? document.querySelector("main[role='main']") ?? document.querySelector("main");
  if (!root) return null;
  const clone = root.cloneNode(true) as Element;
  for (const sel of ["nav", "header", "footer", "aside", "script", "style", "noscript"]) {
    for (const node of Array.from(clone.querySelectorAll(sel))) node.remove();
  }
  const text = plainTextFromPage(clone.innerHTML, "text/html", 16_000);
  return text.length >= 80 ? text : null;
}

function normalizePlainText(text: string, maxChars: number): string {
  return text
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/ *\r?\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

/**
 * Readability-style article body extraction before claim verification.
 * Order: JSON-LD articleBody → &lt;article&gt;/&lt;main&gt; → Mozilla Readability.
 */
export function extractArticleBodyFromHtml(
  raw: string,
  pageUrl: string,
  maxChars = 16_000,
): ExtractedArticleBody | null {
  const jsonLdBody = extractJsonLdArticleBody(raw);
  const { document } = parseHTML(raw);
  const headline = extractHeadlineFromHtml(raw, document);

  if (jsonLdBody) {
    return {
      text: normalizePlainText(jsonLdBody, maxChars),
      headline,
      source: "json-ld-articleBody",
    };
  }

  const mainText = extractArticleMainText(document);
  if (mainText) {
    return {
      text: normalizePlainText(mainText, maxChars),
      headline,
      source: "article-main",
    };
  }

  try {
    const readable = new Readability(document, { charThreshold: 80 }).parse();
    if (readable?.textContent && readable.textContent.trim().length >= 80) {
      return {
        text: normalizePlainText(readable.textContent, maxChars),
        headline: readable.title?.trim() ? decodeBasicHtmlEntities(readable.title.trim()) : headline,
        source: "readability",
      };
    }
  } catch {
    // fall through
  }

  void pageUrl;
  return null;
}

export { decodeBasicHtmlEntities as decodeHtmlEntitiesForEvidence };
