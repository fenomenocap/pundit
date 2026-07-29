interface MetricCardProps {
  label: string;
  value: string;
  hint: string;
}

export function MetricCard({ label, value, hint }: MetricCardProps) {
  return (
    <dl className="rounded-lg border border-card-rim shadow-card px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl text-white">{value}</dd>
      <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd>
    </dl>
  );
}