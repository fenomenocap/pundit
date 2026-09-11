const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;

export function formatDeskShortDate(raw: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!match) return raw;
  const month = SHORT_MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month}` : raw;
}

function cleanCitationTitle(title: string): string {
  return title.replace(/\s+/g, " ").replace(/\s+\]$/, "").trim();
}

export function humaniseDeskCitationDates(text: string): string {
  return text
    .replace(/(\S)\(\[/g, "$1 ([")
    .replace(ISO_INSTANT, (iso) => formatDeskShortDate(iso))
    .replace(
      /\(?\[([^\]]{1,180})\]\((https?:\/\/[^\s)]+)\)(?:,\s*([^)]{1,48}))?\)?/g,
      (_all, title: string, url: string, date?: string) => {
        const cleanTitle = cleanCitationTitle(String(title));
        const when = date ? formatDeskShortDate(date.trim()) : "";
        return when
          ? `([${cleanTitle}](${url}) · ${when})`
          : `([${cleanTitle}](${url}))`;
      },
    );
}
