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
import { SourcesToggle } from "@/components/sources-toggle";

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-sm bg-bg/60 px-2 py-1.5">
      <dt className="text-2xs uppercase tracking-wider text-quiet truncate">{k}</dt>
      <dd className="mt-0.5 tabular-nums text-sm text-fg">{v}</dd>
    </div>
  );
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
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
      data-fixture-id={grounding.fixtureId}
      data-capability="priced"
      data-p-home={grounding.pHome}
      data-p-draw={grounding.pDraw}
      data-p-away={grounding.pAway}
      data-rating-artifact-id={grounding.pricing.modelVersion}
      data-priced-at={grounding.pricing.pricedAt}
      className="mt-4 rounded-md border border-border bg-elevated/40 px-3 py-3"
    >
      <div className="eyebrow text-quiet mb-2">Our board</div>
      <p className="mb-2 text-2xs text-quiet">Our probabilities · fair decimal odds</p>
      <ProbBar home={oneXTwo.pHome} draw={oneXTwo.pDraw} away={oneXTwo.pAway} />
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat k={oneXTwo.home} v={`${fmtPct(oneXTwo.pHome)} · ${formatFairOdds(oneXTwo.fairHome)}`} />
        <Stat k="Draw" v={`${fmtPct(oneXTwo.pDraw)} · ${formatFairOdds(oneXTwo.fairDraw)}`} />
        <Stat k={oneXTwo.away} v={`${fmtPct(oneXTwo.pAway)} · ${formatFairOdds(oneXTwo.fairAway)}`} />
      </dl>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat k="Over 2.5" v={fmtPct(board.over25, 1)} />
        <Stat k="Under 2.5" v={fmtPct(board.under25, 1)} />
        <Stat k="BTTS Yes" v={fmtPct(board.bttsYes, 1)} />
      </dl>
      <p className="mt-2 text-2xs text-quiet">Over and under 2.5 are complementary probabilities and sum to 100%.</p>
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
          <p className="flex items-baseline justify-between gap-3 text-2xs">
            <span className="text-quiet">
              Market average{board.markets.length > 1 ? ` (${board.markets.length} sources)` : ""}
            </span>
            <span className="tabular-nums">
              {formatPercent(average(board.markets.map((row) => row.pHome)))} /{" "}
              {formatPercent(average(board.markets.map((row) => row.pDraw)))} /{" "}
              {formatPercent(average(board.markets.map((row) => row.pAway)))}
            </span>
          </p>
        )}
      </div>
      <SourcesToggle className="mt-3" testId="desk-board-sources">
        <p data-testid="desk-totals-honesty">{board.totalsHonesty}</p>
        {board.markets.length > 0 ? (
          <ul className="space-y-1">
            {board.markets.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-3">
                <span>{row.label}</span>
                <span className="tabular-nums">
                  {formatPercent(row.pHome)} / {formatPercent(row.pDraw)} / {formatPercent(row.pAway)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </SourcesToggle>
    </div>
  );
}
