"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus } from "lucide-react";
import { rankedOpen, weekendNote } from "@/desk/lib/brief";
import { getFixture, isLivePricedFixture } from "@/desk/lib/data/fixtures";
import { TEAMS } from "@/desk/lib/data/teams";
import { completedDeskHistory } from "@/desk/lib/chat-history";
import { askPundit } from "@/desk/lib/pundit";
import { useDesk, type ChatMsg } from "@/desk/lib/store";
import type { OneXTwoOutcome } from "@/lib/api";
import { userLinePayloadForAsk } from "@/lib/fixture-presentation";
import { SafeMarkdown } from "@/lib/safe-markdown";
import { cn } from "@/lib/utils";
import { humaniseDeskCitationDates } from "@/desk/lib/prose";
import { DeskBoard } from "@/desk/components/desk-board";
import { FormDots } from "@/desk/components/form-dots";
import { KitPip } from "@/desk/components/kit";
import { Button } from "@/desk/components/ui/button";
import { useLiveSlate } from "@/desk/components/use-live-slate";

const SLATE_CHIPS = [
  "Walk the slate",
  "Banker of the weekend",
  "The derby",
        "Who scored recently?",
];

export function AgentPane() {
  const messages = useDesk((s) => s.messages);
  const push = useDesk((s) => s.pushChat);
  const removeChat = useDesk((s) => s.removeChat);
  const reset = useDesk((s) => s.resetChat);
  const selectedId = useDesk((s) => s.selectedId);
  const queued = useDesk((s) => s.queuedAsk);
  const clearQueued = useDesk((s) => s.clearQueuedAsk);
  const select = useDesk((s) => s.selectFixture);
  const fixture = getFixture(selectedId);
  const liveFixture = isLivePricedFixture(fixture) ? fixture : undefined;
  const { source } = useLiveSlate();
  const [draft, setDraft] = useState("");
  const [lineOutcome, setLineOutcome] = useState<OneXTwoOutcome>("home");
  const [lineDecimal, setLineDecimal] = useState("");
  const [lineFixtureId, setLineFixtureId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const opening = (() => {
    if (source === "pending") return "Loading the live fixture slate…";
    if (source === "unavailable") {
      return "I can’t load the live fixture slate right now. Try again shortly, or ask a general football question.";
    }
    if (source === "no-fixtures") {
      return "No priced fixtures are live right now. I can still answer a general football question.";
    }
    return weekendNote();
  })();
  const ranked = rankedOpen().slice(0, 3);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const matchChips = liveFixture
    ? [
        `How do ${TEAMS[liveFixture.home].short} win this?`,
        "Tactical matchup",
        "Who decides it?",
        "Projected score",
        "What are the odds",
        "BTTS?",
        "Over 2.5?",
        "+EV",
      ]
    : SLATE_CHIPS;

  async function send(text: string, fixtureId = liveFixture?.id ?? "") {
    const q = text.trim();
    if (!q || busy) return;
    if (q.length > 500) {
      setErr("Questions must be 500 characters or fewer.");
      return;
    }
    setErr(null);
    setDraft("");
    const history = completedDeskHistory(useDesk.getState().messages);
    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: "user",
      text: q,
      fixtureId: fixtureId || undefined,
      at: Date.now(),
    };
    push(userMsg);
    setBusy(true);
    try {
      const res = await askPundit({
        data: {
          question: q,
          history,
          fixtureId: fixtureId || undefined,
          userLine: lineFixtureId === fixtureId
            ? userLinePayloadForAsk(q, lineOutcome, lineDecimal)
            : undefined,
        },
      });
      // Only a resolved server identity replaces the pin. A clarification or
      // general answer keeps it, and an in-flight reply cannot undo a newer click.
      const resolvedFixtureId = res.grounding?.kind === "match"
        ? res.grounding.fixtureId
        : res.grounding?.kind === "fixture" ? res.grounding.fixture.fixtureId : undefined;
      if (resolvedFixtureId && useDesk.getState().selectedId === fixtureId) {
        select(resolvedFixtureId);
      }
      push({
        id: `p-${Date.now()}`,
        role: "pundit",
        text: res.text || opening,
        fixtureId: resolvedFixtureId || fixtureId || undefined,
        grounding: res.grounding,
        at: Date.now(),
      });
    } catch (e) {
      removeChat(userMsg.id);
      setErr(e instanceof Error && e.message ? e.message : "Pundit is quiet. Try again.");
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  useEffect(() => {
    if (!queued) return;
    const q = queued;
    clearQueued();
    void send(q);
    // send is recreated each render; we only fire when queuedAsk changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued]);

  useEffect(() => {
    setLineOutcome("home");
    setLineDecimal("");
    setLineFixtureId("");
  }, [selectedId]);

  return (
    <section className="flex min-h-[58dvh] lg:min-h-0 flex-col bg-bg lg:h-[calc(100dvh-7.5rem)]">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="min-w-0">
          <div className="eyebrow text-accent">Pundit</div>
          <p className="text-sm text-quiet truncate">
            {liveFixture
              ? `Pinned · ${TEAMS[liveFixture.home].short} vs ${TEAMS[liveFixture.away].short}`
              : source === "live"
                ? "Slate · live"
                : source === "no-fixtures"
                  ? "Slate · no priced fixtures"
                  : source === "static" ? "Slate · mock" : "Slate unavailable"}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            reset();
            setDraft("");
            setLineOutcome("home");
            setLineDecimal("");
            setLineFixtureId("");
            setErr(null);
            window.history.replaceState({}, "", window.location.pathname);
          }}
          disabled={busy || (messages.length === 0 && !liveFixture)}
        >
          <Plus className="size-3.5" />
          New Chat
        </Button>
      </header>

      <div
        ref={scroller}
        data-testid="desk-chat-transcript"
        className="flex-1 overflow-y-auto px-4 py-4 space-y-5"
      >
        {messages.length === 0 ? (
          <div>
            <p className="font-display uppercase tracking-wide text-3xl sm:text-4xl leading-none text-fg">
              Ask the weekend.
            </p>
            <p className="mt-3 text-sm text-quiet max-w-xl">
              Match forecasts, xG, form and tactics. Analysis only — not betting advice.
            </p>
            <p className="mt-5 text-sm leading-7 text-fg/85 whitespace-pre-wrap">{opening}</p>
            <div className="mt-5 grid gap-1.5">
              {ranked.map(({ f, p }) => (
                <button
                  key={f.id}
                  data-testid="desk-featured-fixture"
                  data-fixture-id={f.id}
                  data-home={TEAMS[f.home].name}
                  data-away={TEAMS[f.away].name}
                  type="button"
                  onClick={() => {
                    select(f.id);
                    void send(
                      `Give me the match briefing for ${TEAMS[f.home].name} vs ${TEAMS[f.away].name}.`,
                      f.id,
                    );
                  }}
                  className="flex items-center gap-3 rounded-sm border border-border bg-surface px-3 py-2.5 text-left hover:border-border-strong hover:bg-elevated transition-colors duration-150 min-h-11"
                >
                  <KitPip team={f.home} />
                  <span className="font-display text-lg uppercase tracking-wide leading-none">
                    {TEAMS[f.home].short}
                  </span>
                  <span className="text-subtle text-xs">vs</span>
                  <KitPip team={f.away} />
                  <span className="font-display text-lg uppercase tracking-wide leading-none">
                    {TEAMS[f.away].short}
                  </span>
                  <span className="ml-auto font-display text-lg tabular-nums text-accent">
                    {Math.round(p * 100)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} msg={m} />)
        )}
        {busy ? (
          <div>
            <div className="eyebrow mb-2">Pundit</div>
            <p className="shimmer text-sm text-quiet">Writing the take…</p>
          </div>
        ) : null}
        {err ? <p role="alert" className="text-sm text-down">{err}</p> : null}
      </div>

      <div className="border-t border-border bg-surface px-3 sm:px-4 py-3">
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {matchChips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={busy}
              onClick={() => void send(chip)}
              className="h-8 rounded-full border border-border px-3 text-2xs uppercase tracking-wide text-quiet hover:text-fg hover:border-border-strong transition-colors duration-150 disabled:opacity-40"
            >
              {chip}
            </button>
          ))}
        </div>
        {liveFixture ? (
          <div
            data-testid="desk-user-line-control"
            className="mb-2.5 flex flex-wrap items-center gap-1.5"
          >
            <span className="text-2xs uppercase tracking-wide text-quiet">Line</span>
            {([
              ["home", TEAMS[liveFixture.home].short],
              ["draw", "Draw"],
              ["away", TEAMS[liveFixture.away].short],
            ] as const).map(([outcome, label]) => (
              <button
                key={outcome}
                type="button"
                disabled={busy}
                data-testid={`desk-user-line-outcome-${outcome}`}
                aria-pressed={lineOutcome === outcome}
                onClick={() => {
                  setLineOutcome(outcome);
                  setLineFixtureId(liveFixture.id);
                }}
                className={cn(
                  "h-8 rounded-full border px-3 text-2xs uppercase tracking-wide transition-colors duration-150 disabled:opacity-40",
                  lineOutcome === outcome
                    ? "border-accent text-fg bg-accent/15"
                    : "border-border text-quiet hover:text-fg hover:border-border-strong",
                )}
              >
                {label}
              </button>
            ))}
            <label className="sr-only" htmlFor="desk-user-line-decimal">
              Decimal odds
            </label>
            <input
              id="desk-user-line-decimal"
              data-testid="desk-user-line-decimal"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              value={lineDecimal}
              placeholder="2.10"
              onChange={(e) => {
                setLineDecimal(e.target.value);
                setLineFixtureId(liveFixture.id);
              }}
              className="h-8 w-[4.5rem] rounded-sm border border-border bg-elevated px-2 text-sm tabular-nums text-fg placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-40"
            />
            <span className="text-2xs text-subtle">decimal · analysis only</span>
          </div>
        ) : null}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <label className="sr-only" htmlFor="pundit-ask">
            Ask Pundit
          </label>
          <textarea
            id="pundit-ask"
            ref={box}
            rows={1}
            value={draft}
            maxLength={500}
            aria-invalid={err === "Questions must be 500 characters or fewer."}
            disabled={busy}
            suppressHydrationWarning
            onChange={(e) => {
              const next = e.target.value;
              setDraft(next);
              if (next.length > 500) setErr("Questions must be 500 characters or fewer.");
              else if (err === "Questions must be 500 characters or fewer.") setErr(null);
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text");
              const nextLength = draft.length - (e.currentTarget.selectionEnd - e.currentTarget.selectionStart) + pasted.length;
              if (nextLength <= 500) return;
              e.preventDefault();
              setErr("Questions must be 500 characters or fewer.");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder="Ask a match, a player, the slate"
            aria-label="Ask a question"
            className="min-h-11 max-h-32 flex-1 rounded-sm border border-border bg-elevated px-3 py-2.5 text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <Button
            type="submit"
            size="icon"
            variant="accent"
            disabled={busy || draft.trim().length === 0}
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </Button>
        </form>
        {liveFixture ? (
          <div className="mt-2 flex items-center gap-2 text-2xs text-quiet">
            <FormDots team={liveFixture.home} size="sm" />
            <span>
              {TEAMS[liveFixture.home].short} vs {TEAMS[liveFixture.away].short}
            </span>
            <FormDots team={liveFixture.away} size="sm" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Bubble({ msg }: { msg: ChatMsg }) {
  const f = msg.fixtureId ? getFixture(msg.fixtureId) : undefined;
  const groundingLabel = msg.grounding === undefined ? null
    : msg.grounding?.kind === "season" ? `Season outlook · ${msg.grounding.competition}`
      : msg.grounding?.kind === "competition" ? `Current table · ${msg.grounding.competition}`
        : msg.grounding?.kind === "match" ? "Match forecast"
          : msg.grounding?.kind === "fixture" ? "Fixture context"
            : "General analysis";
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          data-testid="desk-user-bubble"
          className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] sm:max-w-[36rem] rounded-md rounded-br-xs bg-elevated px-3.5 py-2.5 text-sm leading-6"
        >
          {msg.text}
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] sm:max-w-[40rem]" data-testid="desk-pundit-bubble">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="eyebrow text-accent">Pundit</span>
        {groundingLabel ? (
          <span data-testid="desk-grounding-label" className="min-w-0 truncate text-2xs text-subtle">
            {groundingLabel}
          </span>
        ) : null}
        {f ? (
          <span className="text-2xs text-subtle">
            {TEAMS[f.home].short}–{TEAMS[f.away].short}
          </span>
        ) : null}
      </div>
      <div className="text-sm leading-7 text-fg/90">
        <SafeMarkdown
          content={humaniseDeskCitationDates(msg.text)}
          paragraphClassName="mb-2 last:mb-0"
          strongClassName="font-semibold"
          linkClassName="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        />
      </div>
      {msg.grounding ? <DeskBoard grounding={msg.grounding} /> : null}
    </div>
  );
}
