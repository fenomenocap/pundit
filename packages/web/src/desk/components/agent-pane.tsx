"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Plus } from "lucide-react";
import { rankedOpen, weekendNote } from "@/desk/lib/brief";
import { getFixture } from "@/desk/lib/data/fixtures";
import { TEAMS } from "@/desk/lib/data/teams";
import { completedDeskHistory } from "@/desk/lib/chat-history";
import { askPundit } from "@/desk/lib/pundit";
import { useDesk, type ChatMsg } from "@/desk/lib/store";
import { cn } from "@/lib/utils";
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
  const { epoch, source } = useLiveSlate();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const opening = useMemo(() => weekendNote(), [epoch]);
  const ranked = useMemo(() => rankedOpen().slice(0, 3), [epoch]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const matchChips = fixture
    ? [
        `How do ${TEAMS[fixture.home].short} win this?`,
        "Tactical matchup",
        "Who decides it?",
        "Projected score",
      ]
    : SLATE_CHIPS;

  async function send(text: string) {
    const q = text.trim().slice(0, 500);
    if (!q || busy) return;
    setErr(null);
    setDraft("");
    const history = completedDeskHistory(useDesk.getState().messages);
    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: "user",
      text: q,
      fixtureId: selectedId,
      at: Date.now(),
    };
    push(userMsg);
    setBusy(true);
    try {
      const res = await askPundit({
        data: { question: q, history, fixtureId: selectedId },
      });
      push({
        id: `p-${Date.now()}`,
        role: "pundit",
        text: res.text || opening,
        fixtureId: selectedId,
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

  return (
    <section className="flex min-h-[58dvh] lg:min-h-0 flex-col bg-bg lg:h-[calc(100dvh-7.5rem)]">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="min-w-0">
          <div className="eyebrow text-accent">Pundit</div>
          <p className="text-sm text-quiet truncate">
            {fixture
              ? `Pinned · ${TEAMS[fixture.home].short} vs ${TEAMS[fixture.away].short}`
              : source === "live"
                ? "Slate · live ClubElo"
                : "Slate · GW4"}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            reset();
            setErr(null);
          }}
          disabled={busy || messages.length === 0}
        >
          <Plus className="size-3.5" />
          New
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
                  type="button"
                  onClick={() => {
                    select(f.id);
                    void send(
                      `Give me the match briefing for ${TEAMS[f.home].name} vs ${TEAMS[f.away].name}.`,
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
            disabled={busy}
            suppressHydrationWarning
            onChange={(e) => setDraft(e.target.value)}
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
        {fixture ? (
          <div className="mt-2 flex items-center gap-2 text-2xs text-quiet">
            <FormDots team={fixture.home} size="sm" />
            <span>
              {TEAMS[fixture.home].short} vs {TEAMS[fixture.away].short}
            </span>
            <FormDots team={fixture.away} size="sm" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Bubble({ msg }: { msg: ChatMsg }) {
  const f = msg.fixtureId ? getFixture(msg.fixtureId) : undefined;
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          data-testid="desk-user-bubble"
          className="max-w-[36rem] rounded-md rounded-br-xs bg-elevated px-3.5 py-2.5 text-sm leading-6"
        >
          {msg.text}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[40rem]">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="eyebrow text-accent">Pundit</span>
        {f ? (
          <span className="text-2xs text-subtle">
            {TEAMS[f.home].short}–{TEAMS[f.away].short}
          </span>
        ) : null}
      </div>
      <p className={cn("text-sm leading-7 text-fg/90 whitespace-pre-wrap")}>{msg.text}</p>
    </div>
  );
}
