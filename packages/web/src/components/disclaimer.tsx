export const DISCLAIMER_TEXT = "Analysis only — not betting advice";

export function Disclaimer({ className }: { className?: string }) {
  return <span className={className}>{DISCLAIMER_TEXT}</span>;
}
