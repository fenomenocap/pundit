import { ProbBar } from "@/desk/components/prob-bar";
import type { FixtureGrounding, MatchGrounding } from "@/lib/api";
import {
  capabilityLabel,
  deskBoardFromGrounding,
  formatEdgeBand,
  formatFairOdds,
  formatPercent,
  formatSignedEvPct,
  NO_COMPARISON_MARKET,
} from "@/lib/fixture-presentation";

export function DeskUnpricedNotice({ grounding }: { grounding: FixtureGrounding }) {
  return (
    <div
      data-testid="desk-board-unpriced"
      className="mt-3 rounded-sm border border-border bg-surface px-3 py-3 space-y-1"
    >
      <div className="eyebrow">Board</div>
      <p className="text-sm text-quiet">{capabilityLabel(grounding.capability)}</p>
    </div>
  );
}

export function DeskBoard({ grounding }: { grounding: MatchGrounding }) {
  const board = deskBoardFromGrounding(grounding);
  const { oneXTwo } = board;

  return (
    <div
      data-testid="desk-board"
      className="mt-3 rounded-sm border border-border bg-surface px-3 py-3 space-y-3"
    >
      <ProbBar home={oneXTwo.pHome} draw={oneXTwo.pDraw} away={oneXTwo.pAway} />

      <div
        data-testid="desk-board-fair-odds"
        className="grid grid-cols-3 gap-2 text-center"
      >
        <FairCell
          label={oneXTwo.home}
          percent={oneXTwo.pHome}
          fair={oneXTwo.fairHome}
        />
        <FairCell label="Draw" percent={oneXTwo.pDraw} fair={oneXTwo.fairDraw} />
        <FairCell
          label={oneXTwo.away}
          percent={oneXTwo.pAway}
          fair={oneXTwo.fairAway}
        />
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat
          k="BTTS yes / no"
          v={`${formatPercent(board.bttsYes)} / ${formatPercent(board.bttsNo)}`}
        />
        <Stat
          k="O/U 2.5"
          v={`O ${formatPercent(board.over25)} / U ${formatPercent(board.under25)}`}
        />
      </dl>
      <p className="text-2xs leading-relaxed text-quiet">{board.totalsHonesty}</p>

      {board.topScores.length > 0 ? (
        <div>
          <div className="eyebrow mb-1.5">Top scores</div>
          <p className="text-sm tabular-nums text-fg/90">
            {board.topScores
              .map((row) => `${row.score} ${formatPercent(row.probability)}`)
              .join(" · ")}
          </p>
        </div>
      ) : null}

      {board.consensus ? (
        <div data-testid="desk-board-consensus">
          <div className="eyebrow mb-1.5">{board.consensus.label}</div>
          <p className="text-sm tabular-nums">
            {formatPercent(board.consensus.pHome)} / {formatPercent(board.consensus.pDraw)} / {formatPercent(board.consensus.pAway)}
          </p>
          <p className="mt-1 text-2xs leading-relaxed text-quiet">
            Labelled shrink toward a timestamped no-vig market, not the sealed Fundamental 1X2.
          </p>
        </div>
      ) : null}

      <div data-testid="desk-board-markets">
        <div className="eyebrow mb-1.5">Markets</div>
        {board.markets.length === 0 ? (
          <p className="text-sm text-quiet">{NO_COMPARISON_MARKET}</p>
        ) : (
          <ul className="space-y-1">
            {board.markets.map((row) => (
              <li
                key={row.id}
                className="flex items-baseline justify-between gap-3 text-sm"
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

      {board.userLine ? (
        <div data-testid="desk-board-user-line">
          <div className="eyebrow mb-1.5">Your line</div>
          <p className="text-sm tabular-nums">
            {board.userLine.outcomeLabel} @ {board.userLine.decimalOdds.toFixed(2)}
            {" · "}
            <span className="text-accent">{formatSignedEvPct(board.userLine.evPct)}</span>
            {" · "}
            {board.userLine.edgeBand}
          </p>
        </div>
      ) : null}

      {board.capturedEv.map((row) => (
        <div key={row.source} data-testid={`desk-board-ev-${row.source}`}>
          <div className="eyebrow mb-1.5">{row.source}</div>
          <p className="text-2xs text-quiet">{formatEdgeBand(row.edgeBand)}</p>
          <p className="text-sm tabular-nums">
            {(["home", "draw", "away"] as const)
              .map((outcome) => {
                const leg = row.legs[outcome];
                if (!leg) return null;
                return `${outcome} ${formatSignedEvPct(leg.evPct)}`;
              })
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ))}
    </div>
  );
}

function FairCell({
  label,
  percent,
  fair,
}: {
  label: string;
  percent: number;
  fair: number;
}) {
  return (
    <div className="rounded-sm border border-border bg-elevated px-2 py-2 min-w-0">
      <div className="eyebrow truncate" title={label}>{label}</div>
      <div className="mt-1 font-display text-lg tabular-nums leading-none">
        {formatPercent(percent)}
      </div>
      <div className="mt-1 text-2xs tabular-nums text-quiet">
        fair {formatFairOdds(fair)}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-sm border border-border bg-elevated px-2 py-2">
      <dt className="eyebrow">{k}</dt>
      <dd className="mt-1 font-display text-base tabular-nums leading-none">{v}</dd>
    </div>
  );
}
