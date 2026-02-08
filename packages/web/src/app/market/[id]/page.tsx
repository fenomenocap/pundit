export default function MarketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Market Detail
      </h1>
      <p className="mt-2 text-muted-foreground">
        Market ID: {params.id}
      </p>
    </div>
  );
}
