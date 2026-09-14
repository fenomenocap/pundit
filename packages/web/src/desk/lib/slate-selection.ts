type SelectableFixture = {
  id: string;
  home: string;
  away: string;
};

/** Resolve persisted selection only against the authoritative hydrated slate. */
export function resolveHydratedSelection(
  selectedId: string,
  open: readonly SelectableFixture[],
  settled: readonly SelectableFixture[],
): string {
  if (open.some((fixture) => fixture.id === selectedId)
    || settled.some((fixture) => fixture.id === selectedId)) {
    return selectedId;
  }
  return "";
}

type FixtureBoundLeg = { fixtureId: string };
type FixtureBoundTicket = { legs: readonly FixtureBoundLeg[] };

/** Remove persisted paper state which is not represented by the hydrated slate. */
export function reconcileHydratedPaperState<TLeg extends FixtureBoundLeg, TTicket extends FixtureBoundTicket>(
  slip: readonly TLeg[],
  tickets: readonly TTicket[],
  scores: Readonly<Record<string, [number, number]>>,
  open: readonly SelectableFixture[],
  settled: readonly SelectableFixture[],
) {
  const allIds = new Set([...open, ...settled].map((fixture) => fixture.id));
  const openIds = new Set(open.map((fixture) => fixture.id));
  const validTickets = tickets.filter((ticket) => ticket.legs.every((leg) => allIds.has(leg.fixtureId)));
  return {
    slip: slip.filter((leg) => openIds.has(leg.fixtureId)),
    tickets: validTickets,
    removedTickets: tickets.filter((ticket) => !validTickets.includes(ticket)),
    scores: Object.fromEntries(Object.entries(scores).filter(([id]) => allIds.has(id))),
  };
}

export function capturedRecord(rows: readonly { modelHit?: boolean }[]) {
  const captured = rows.filter((row) => typeof row.modelHit === "boolean");
  const hits = captured.filter((row) => row.modelHit).length;
  return { hits, n: captured.length, pct: captured.length ? hits / captured.length : null };
}
