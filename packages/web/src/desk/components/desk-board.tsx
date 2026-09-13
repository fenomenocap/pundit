"use client";

import type { AskGrounding } from "@/lib/api";
import {
  canRenderDeskBoard,
  deskBoardFromGrounding,
  formatEdgeBand,
  formatFairOdds,
  formatSignedEvPct,
  formatPercent,
  NO_COMPARISON_MARKET,
} from "@/lib/fixture-presentation";
import { fmtPct } from "@/desk/lib/format";
import { ProbBar } from "@/desk/components/prob-bar";

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-sm bg-bg/60 px-2 py-1.5">
      <dt className="text-2xs uppercase tracking-wider text-quiet truncate">{k}</dt>
      <dd className="mt-0.5 tabular-nums text-sm text-fg">{v}</dd>
    </div>
  );
}

export function DeskUnpricedNotice() {
  return (
    <p data-testid="desk-unpriced-notice" className="mt-3 text-sm text-quiet">
      This fixture is recognised but not priced, so there is no Pundit board.
    </p>
  );
}

export function DeskBoard({ grounding }: { grounding?: AskGrounding }) {
  if (grounding?.kind === "fixture") return <DeskUnpricedNotice />;
  if (grounding?.kind !== "match" || !canRenderDeskBoard(grounding)) return null;
  const board = deskBoardFromGrounding(grounding);
  const { oneXTwo, userLine } = board;
  const band = userLine ? formatEdgeBand(userLine.edgeBand) : null;

  return (
    <div
      data-testid="desk-match-board"
      className="mt-4 rounded-md border border-border bg-elevated/40 px-3 py-3"
    >
      <div className="eyebrow text-quiet mb-2">Model board</div>
      <ProbBar home={oneXTwo.pHome} draw={oneXTwo.pDraw} away={oneXTwo.pAway} />
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat k={oneXTwo.home} v={`${fmtPct(oneXTwo.pHome)} · ${formatFairOdds(oneXTwo.fairHome)}`} />
        <Stat k="Draw" v={`${fmtPct(oneXTwo.pDraw)} · ${formatFairOdds(oneXTwo.fairDraw)}`} />
        <Stat k={oneXTwo.away} v={`${fmtPct(oneXTwo.pAway)} · ${formatFairOdds(oneXTwo.fairAway)}`} />
      </dl>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat k="O2.5" v={fmtPct(board.over25)} />
        <Stat k="U2.5" v={fmtPct(board.under25)} />
        <Stat k="BTTS" v={fmtPct(board.bttsYes)} />
      </dl>
      {board.topScores.length > 0 ? (
        <p className="mt-3 text-2xs text-quiet">
          Leading scores{" "}
          {board.topScores.map((row) => `${row.score} ${fmtPct(row.probability)}`).join(" · ")}
        </p>
      ) : null}
      {userLine ? (
        <p data-testid="desk-posted-line" className="mt-2 text-2xs text-quiet">
          Posted line {userLine.outcomeLabel} @ {userLine.decimalOdds.toFixed(2)}
          {" · "}EV {formatSignedEvPct(userLine.evPct)}
          {band ? ` · ${band}` : ""}
        </p>
      ) : null}
      <div data-testid="desk-board-markets" className="mt-2">
        <div className="eyebrow text-quiet mb-1">Markets</div>
        {board.markets.length === 0 ? (
          <p className="text-2xs text-quiet">{NO_COMPARISON_MARKET}</p>
        ) : (
          <ul className="space-y-1">
            {board.markets.map((row) => (
              <li
                key={row.id}
                className="flex items-baseline justify-between gap-3 text-2xs"
              >
                <span className="text-quiet">{row.label}</span>
                <span className="tabular-nums">
                  {formatPercent(row.pHome)} / {formatPercent(row.pDraw)} / {formatPercent(row.pAway)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-2xs leading-5 text-quiet">{board.totalsHonesty}</p>
    </div>
  );
}
