/** Split v2 sources footer (single newlines) into markdown paragraphs. */
export function prepareTakeV2DeskMarkdown(content: string): string {
  const marker = "\n\nModel ";
  const idx = content.indexOf(marker);
  if (idx < 0) return content;
  const head = content.slice(0, idx).trimEnd();
  const footerBlock = content.slice(idx + 2).trim();
  const footerLines = footerBlock.split("\n").map((line) => line.trim()).filter(Boolean);
  if (footerLines.length <= 1) return content;
  return `${head}\n\n${footerLines.join("\n\n")}`;
}
