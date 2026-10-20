import type { PunditTakePlan } from "./types";

function formatGridTable(plan: PunditTakePlan): string {
  if (!plan.gridRows.length) return "No price yet.";
  const headers = ["Outcome", "Ours", ...plan.marketColumns.map((c) => c.shortLabel), "Best"];
  const sep = headers.map(() => "---");
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
  ];
  for (const row of plan.gridRows) {
    const ours = `${row.modelPctInt}% / ${row.fairDecimal}`;
    const sourceCells = plan.marketColumns.map((col) => row.sourceDecimals[col.sourceKey] ?? "—");
    const best = row.bestDecimal ?? "—";
    if (plan.marketColumns.length === 0) {
      lines.push(`| ${row.label} | ${ours} | ${best} |`);
    } else {
      lines.push(`| ${row.label} | ${ours} | ${sourceCells.join(" | ")} | ${best} |`);
    }
  }
  if (!plan.hasCompleteMarket && plan.marketColumns.length === 0) {
    lines.push("", "No price yet.");
  }
  return lines.join("\n");
}

export function formatTakeOddsTable(plan: PunditTakePlan): string {
  if (plan.marketKind !== "1x2") {
    return formatGridTable(plan);
  }

  if (!plan.hasCompleteMarket) {
    const row = plan.rows.find((r) => r.outcome === plan.call.outcome) ?? plan.rows[0];
    if (!row) return "No price yet.";
    return [
      "| Outcome | Ours |",
      "| --- | --- |",
      `| ${row.label} | ${row.modelPctInt}% / ${row.fairDecimal} |`,
      "",
      "No price yet.",
    ].join("\n");
  }

  const headers = ["Outcome", "Ours", ...plan.marketColumns.map((c) => c.shortLabel), "Best"];
  const sep = headers.map(() => "---");
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
  ];
  for (const row of plan.rows) {
    const ours = `${row.modelPctInt}% / ${row.fairDecimal}`;
    const sourceCells = plan.marketColumns.map((col) => row.sourceDecimals[col.sourceKey] ?? "—");
    const best = row.bestDecimal ?? "—";
    lines.push(`| ${row.label} | ${ours} | ${sourceCells.join(" | ")} | ${best} |`);
  }
  return lines.join("\n");
}
