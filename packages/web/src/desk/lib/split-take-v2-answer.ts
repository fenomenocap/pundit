/** Split v2 take answer prose/table from trailing sources footer (unchanged API string). */
export function splitTakeV2AnswerBodyAndFooter(content: string): {
  body: string;
  footerLines: string[];
} {
  const marker = "\n\nModel ";
  const idx = content.indexOf(marker);
  if (idx < 0) {
    return { body: content, footerLines: [] };
  }
  const body = content.slice(0, idx).trimEnd();
  const footerBlock = content.slice(idx + 2).trim();
  const footerLines = footerBlock.split("\n").map((line) => line.trim()).filter(Boolean);
  return { body, footerLines };
}
