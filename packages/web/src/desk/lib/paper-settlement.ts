export type PaperMarket = "home" | "draw" | "away" | "over25" | "under25" | "bttsY" | "bttsN";

export type PaperTicket = {
  id: string;
  legs: { fixtureId: string; market: PaperMarket }[];
  stake: number;
  price: number;
  status: "open" | "won" | "lost";
  pnl: number;
};

function legWon(score: [number, number], market: PaperMarket) {
  const [home, away] = score;
  if (market === "home") return home > away;
  if (market === "draw") return home === away;
  if (market === "away") return away > home;
  if (market === "over25") return home + away > 2;
  if (market === "under25") return home + away <= 2;
  if (market === "bttsY") return home > 0 && away > 0;
  return home === 0 || away === 0;
}

export function applyScores<TTicket extends PaperTicket>(
  tickets: TTicket[],
  scores: Record<string, [number, number]>,
  cash: number,
) {
  const nextTickets = tickets.map((ticket) => {
    if (ticket.status !== "open") return ticket;
    const resolved = ticket.legs.map((leg) => {
      const score = scores[leg.fixtureId];
      if (!score) return "open";
      return legWon(score, leg.market) ? "won" : "lost";
    });
    if (resolved.some((result) => result === "open")) return ticket;
    const won = resolved.every((result) => result === "won");
    return {
      ...ticket,
      status: won ? ("won" as const) : ("lost" as const),
      pnl: won ? ticket.stake * ticket.price - ticket.stake : -ticket.stake,
    };
  });
  let credit = 0;
  for (const ticket of nextTickets) {
    const old = tickets.find((candidate) => candidate.id === ticket.id);
    if (old?.status === "open" && ticket.status === "won") credit += ticket.stake * ticket.price;
  }
  return { tickets: nextTickets, cash: cash + credit };
}
