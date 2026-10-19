export function plainTextFromPage(raw: string, contentType: string, maxChars: number): string {
  const withoutNonContent = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  const text = contentType.includes("html")
    ? withoutNonContent
      .replace(/<(?:blockquote|q)\b[^>]*>/gi, "\n“")
      .replace(/<\/(?:blockquote|q)\s*>/gi, "”\n")
      .replace(/<\/?(?:p|h[1-6]|li|ul|ol|div|section|article|header|footer|aside|nav|br|figure|figcaption)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
    : withoutNonContent;
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/ *\r?\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}
