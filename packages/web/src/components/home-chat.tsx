"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ArrowUp } from "lucide-react";
import {
  ApiError,
  askQuestionStream,
  buildAskUrl,
  type AskGrounding,
  type AskPresentation,
  type ConversationTurn,
  type FixtureContext,
  type MatchGrounding,
  type UserLine,
  type ModelFixtureResponse,
  type TeamContext,
  modelFixtureIdentity,
} from "@/lib/api";
import { fetchActiveFixtures, fetchActiveModelFixtures } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Disclaimer } from "@/components/disclaimer";
import { ProbabilityBar } from "@/components/probability-bar";
import { getDocsUrl } from "@/lib/site-links";
import { getTeamMonogram, getTeamColor } from "@/lib/team-logos";
import {
  capabilityLabel,
  formatEdgeBand,
  formatObservedAt,
  formatPercent,
  formatSignedEvPct,
  marketEvFromPricing,
  marketRowSource,
  marketRowsFromGrounding,
  deskChipCopy,
  espnStatusByIdentity,
  fixtureChipCopy,
  isFutureScheduledFixture,
  PULL_CHIP_DECIMAL,
  PULL_CHIP_OUTCOME,
} from "@/lib/fixture-presentation";

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "error";
  content: string;
  grounding?: AskGrounding;
  presentation?: AskPresentation;
}

type LoadingTier = "match" | "fixture" | "competition" | "season" | "general" | null;

let nextId = 0;

/**
 * A chip is a question plus, for a fixture-backed chip, the identity of the
 * fixture it was rendered from. The label alone is ambiguous: both legs of a
 * two-legged tie read "X vs Y", so a chip that sent only its text made the API
 * guess which leg the user had clicked. Carrying the identity makes the click
 * resolve to the rendered fixture and nothing else.
 */
interface Suggestion {
  text: string;
  fixtureContext?: FixtureContext;
  userLine?: UserLine;
}

// Shown whenever no active fixture can be grounded. Deliberately excludes match
// prompts: between rounds there is no fixture to ground one, so a match chip
// promises a model-backed read the model has no data for and lands the user in
// general analysis instead.
const NO_FIXTURE_SUGGESTIONS: Suggestion[] = [
  { text: "What does the current Premier League table show?" },
  { text: "Who is favourite for the Premier League title?" },
  { text: "How does a high defensive line change a team's pressing risks?" },
];

/**
 * Chat can lack match grounding for four different reasons and they are not
 * interchangeable to a user:
 *
 * - `ready`       every active fixture is priced
 * - `partial`     some are priced, some are not — the model reports which on
 *                 /api/model/active's error field, and a question about an
 *                 unpriced fixture returns 503
 * - `unpriced`    fixtures exist but none are priced, so no match question works
 * - `no-fixtures` the window is genuinely empty, between rounds
 * - `unavailable` the fixture list could not be loaded at all
 * - `loading`     first paint, before `/api/model/active` returns
 *
 * These were previously collapsed: any active fixture at all read as `ready`,
 * so the status bar claimed "Model grounded" while the suggestions beneath it
 * returned 503. Partial coverage is a standing state, not a transient one — a
 * club whose rating window has lapsed at the provider stays unpriced until the
 * provider publishes a new one. Defaulting to `ready` while chips were still
 * the no-fixture fallback flashed a live bar over table/title/high-line prompts.
 */
type FixtureState = "loading" | "ready" | "partial" | "unpriced" | "no-fixtures" | "unavailable";

function completedHistory(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user.role === "user" && assistant.role === "assistant") {
      turns.push(
        { role: "user", content: user.content },
        { role: "assistant", content: assistant.content }
      );
      index += 1;
    }
  }
  return turns.slice(-12);
}

function sanitizeAskError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "MODEL_UNAVAILABLE") {
      return "My match forecasts are temporarily unavailable — competition and general questions still work.";
    }
    // Naming more than one matchup is the one 400 with a useful next step in
    // it: the server lists the real fixtures it recognised. Collapsing it into
    // the generic "try rephrasing" line below threw that away and left the user
    // guessing which of their matchups to ask about.
    if (err.code === "MULTIPLE_FIXTURES") {
      return err.message;
    }
    switch (err.status) {
      case 400:
        return "Couldn't understand that — try rephrasing your question.";
      case 404:
        return "No data for that matchup yet.";
      case 429:
        return "You're asking a lot at once — wait a moment and try again.";
      // A timeout and an unreachable service are different problems with
      // different user actions, and collapsing them cost real diagnostic time:
      // a run of timeouts on search-heavy questions was read as the search tool
      // being unwired, because every failure produced identical copy.
      case 504:
        return "That took too long to research — try again, or ask something more specific.";
      case 502:
      case 503:
        return "Analysis is temporarily unavailable — try again shortly.";
      default:
        return "Analysis is temporarily unavailable — try again shortly.";
    }
  }
  if (err instanceof TypeError) {
    return "Connection problem — check your network and try again.";
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("failed to fetch") || msg.includes("network")) {
      return "Connection problem — check your network and try again.";
    }
    if (
      // "anthropic" is still matched alongside "minimax": the backend talks to
      // MiniMax through the Anthropic SDK, so SDK-shaped failures can surface
      // either name.
      msg.includes("minimax")
      || msg.includes("anthropic")
      || msg.includes("api_key")
      || msg.includes("stream ended")
      || msg.includes("configured")
    ) {
      return "Analysis is temporarily unavailable — try again shortly.";
    }
  }
  return "Something went wrong — try again shortly.";
}

function loadingMessage(tier: LoadingTier): string {
  if (tier === "match") return "Checking model & markets…";
  if (tier === "fixture") return "Checking fixture coverage…";
  if (tier === "competition") return "Loading standings…";
  if (tier === "season") return "Simulating season outlook…";
  return "Thinking…";
}

function competitionAbbr(competitionId: string, competition: string): string {
  if (competitionId === "eng.1") return "PL";
  if (competitionId.includes("champions")) return "UCL";
  return competition.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function formatSuggestionChip(fixture: ModelFixtureResponse): Suggestion {
  const day = new Date(fixture.utcDate).toLocaleDateString(undefined, { weekday: "short" });
  const abbr = competitionAbbr(fixture.competitionId, fixture.competition);
  return {
    text: fixtureChipCopy(fixture.home, fixture.away, abbr, day),
    fixtureContext: { fixtureId: modelFixtureIdentity(fixture) },
  };
}

function deskSuggestionChip(fixture: ModelFixtureResponse, index: number): Suggestion {
  return {
    text: deskChipCopy(
      fixture.home,
      fixture.away,
      index % 2 === 0 ? "pass-or-play" : "price-this"
    ),
    fixtureContext: { fixtureId: modelFixtureIdentity(fixture) },
    userLine: { outcome: PULL_CHIP_OUTCOME, decimalOdds: PULL_CHIP_DECIMAL },
  };
}

function featuredDeskSuggestions(fixtures: ModelFixtureResponse[]): Suggestion[] {
  const chips: Suggestion[] = [];
  for (const [index, fixture] of fixtures.entries()) {
    chips.push(formatSuggestionChip(fixture), deskSuggestionChip(fixture, index));
  }
  return chips;
}

function teamAbbr(name: string): string {
  const known: Record<string, string> = {
    Arsenal: "ARS",
    Liverpool: "LIV",
    "Manchester City": "MCI",
    "Manchester United": "MUN",
    Chelsea: "CHE",
    "Tottenham Hotspur": "TOT",
    "Coventry City": "COV",
    "Brighton & Hove Albion": "BHA",
  };
  return known[name] ?? name.slice(0, 3).toUpperCase();
}

function groundingLabel(grounding: AskGrounding): string {
  if (grounding?.kind === "match") {
    return `Match forecast · ${grounding.competition} · ${grounding.date}`;
  }
  if (grounding?.kind === "season") {
    return `Season outlook · ${grounding.competition}`;
  }
  if (grounding?.kind === "competition") {
    return `${grounding.competition} · ESPN table`;
  }
  if (grounding?.kind === "fixture") {
    return `${grounding.fixture.competition.name} · ${capabilityLabel(grounding.capability)}`;
  }
  return "General football analysis";
}

// Three-segment stacked bar is imported from @/components/probability-bar.

function TeamMonogram({ name }: { name: string }) {
  const monogram = getTeamMonogram(name);
  const color = getTeamColor(name);
  if (!monogram) {
    return (
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-card-rim bg-secondary text-[10px] font-bold text-muted-foreground"
        aria-hidden
      >
        ?
      </span>
    );
  }
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {monogram}
    </span>
  );
}

function GroundingBadge({ grounding }: { grounding: AskGrounding }) {
  const kind = grounding?.kind ?? null;
  const ringClass = kind === "match"
    ? "border-primary/40 text-primary"
    : kind === "fixture"
      ? "border-slate-400/40 text-slate-300"
    : kind === "competition"
      ? "border-amber-400/40 text-amber-300"
      : kind === "season"
        ? "border-accent/40 text-accent"
        : "border-border text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border bg-card px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.15em]",
        ringClass
      )}
    >
      {groundingLabel(grounding)}
    </span>
  );
}

// Answers cite team news by source and date, and the search tool knows the URL
// each claim came from. Without "a" in the allow-list, unwrapDisallowed kept the
// link text and silently dropped the href, so a citation the model had grounded
// arrived as unverifiable prose. Rendering the link makes the source checkable
// in one click and lets the answer spend two words on it instead of eight.
//
// Links are the one element here that leaves the page, so they are constrained:
// http(s) only, opened in a new tab, and rel-guarded. react-markdown blocks
// javascript: URLs by default; the explicit check means a change to that
// default cannot quietly re-open the hole.
function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    return ["http:", "https:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      allowedElements={["p", "strong", "em", "ul", "ol", "li", "br", "code", "a"]}
      unwrapDisallowed
      components={{
        p: (props) => <p className="mb-2 last:mb-0" {...props} />,
        ul: (props) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0" {...props} />,
        ol: (props) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0" {...props} />,
        strong: (props) => <strong className="font-semibold text-white" {...props} />,
        a: ({ href, children, ...props }) =>
          isSafeHref(href) ? (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-cyan-400 underline decoration-cyan-400/40 underline-offset-2 hover:decoration-cyan-400"
            >
              {children}
            </a>
          ) : (
            <>{children}</>
          ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageActions({
  content,
  question,
  fixtureId,
}: {
  content: string;
  question: string | null;
  fixtureId?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable
    }
  }

  async function shareQuestion() {
    if (!question) return;
    const url = `${window.location.origin}${buildAskUrl(question, fixtureId)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Pundit", text: question, url });
        return;
      } catch {
        // Fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2 border-t border-border/70 pt-2">
      <button
        type="button"
        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => void copyAnswer()}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {question && (
        <button
          type="button"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => void shareQuestion()}
        >
          Share
        </button>
      )}
    </div>
  );
}

// Match-grounded fixture card — replaces the chat bubble when assistant + match grounding.
function MatchFixtureCard({
  content,
  grounding,
  streaming,
}: {
  content: string;
  grounding: MatchGrounding;
  streaming: boolean;
}) {
  const rows = marketRowsFromGrounding(grounding);
  const evBySource = marketEvFromPricing(grounding.pricing);
  const hasMarkets = rows.length > 1;
  const homeHeader = teamAbbr(grounding.home);
  const awayHeader = teamAbbr(grounding.away);
  return (
    <div
      data-testid="match-fixture-card"
      data-fixture-id={grounding.fixtureId}
      className="mr-auto w-full max-w-[85%] overflow-hidden rounded-lg border border-card-rim bg-card text-foreground shadow-card"
    >
      <div className="flex items-start gap-2 border-b border-card-rim px-3 py-2.5">
        <div className="flex flex-1 items-center gap-2">
          <TeamMonogram name={grounding.home} />
          <span className="truncate text-sm font-medium text-white" title={grounding.home}>
            {teamAbbr(grounding.home)} · {grounding.home}
          </span>
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          vs
        </span>
        <div className="flex flex-1 items-center justify-end gap-2">
          <span className="truncate text-right text-sm font-medium text-white" title={grounding.away}>
            {grounding.away} · {teamAbbr(grounding.away)}
          </span>
          <TeamMonogram name={grounding.away} />
        </div>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <ProbabilityBar
          pHome={grounding.pHome}
          pDraw={grounding.pDraw}
          pAway={grounding.pAway}
        />
        <div className="grid grid-cols-3 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          <span className="text-primary">Home {formatPercent(grounding.pHome)}</span>
          <span className="text-center text-muted-foreground">
            Draw {grounding.pDraw === null ? "—" : formatPercent(grounding.pDraw)}
          </span>
          <span className="text-right text-accent">Away {formatPercent(grounding.pAway)}</span>
        </div>
      </div>
      <div className="border-t border-border/70 px-3 py-2 text-xs leading-tight text-muted-foreground">
        <div className="grid grid-cols-[minmax(4rem,1fr)_repeat(3,minmax(3rem,1fr))] gap-x-2 pb-1 font-mono uppercase tracking-[0.15em] sm:grid-cols-[minmax(5rem,1fr)_repeat(3,3rem)]">
          <span>Source</span>
          <span className="text-right">{homeHeader}</span>
          <span className="text-right">Draw</span>
          <span className="text-right">{awayHeader}</span>
        </div>
        {rows.map((row) => {
          const evRow = evBySource.get(marketRowSource(row) ?? "");
          return (
            <div key={row.id}>
              <div
                className="grid grid-cols-[minmax(4rem,1fr)_repeat(3,minmax(3rem,1fr))] gap-x-2 py-0.5 font-mono sm:grid-cols-[minmax(5rem,1fr)_repeat(3,3rem)]"
              >
                <span className="min-w-0 text-foreground/80">
                  <span className="block truncate">{row.label}</span>
                  {row.observedAt && (
                    <span className="block truncate text-[9px] text-muted-foreground" title={row.observedAt}>
                      {formatObservedAt(row.observedAt)}
                    </span>
                  )}
                </span>
                <span className="text-right">{formatPercent(row.pHome)}</span>
                <span className="text-right">{formatPercent(row.pDraw)}</span>
                <span className="text-right">{formatPercent(row.pAway)}</span>
              </div>
              {evRow && (
                <div
                  data-testid={`market-ev-${evRow.source}`}
                  className="grid grid-cols-[minmax(4rem,1fr)_repeat(3,minmax(3rem,1fr))] gap-x-2 pb-1 font-mono text-[9px] text-muted-foreground sm:grid-cols-[minmax(5rem,1fr)_repeat(3,3rem)]"
                >
                  <span className="min-w-0 truncate">{formatEdgeBand(evRow.edgeBand)}</span>
                  {(["home", "draw", "away"] as const).map((outcome) => {
                    const leg = evRow.legs[outcome];
                    return (
                      <span key={outcome} className="text-right">
                        {leg
                          ? `${formatPercent(leg.impliedP)} · ${formatSignedEvPct(leg.evPct)}`
                          : ""}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {!hasMarkets && (
          <p className="mt-1 text-xs text-muted-foreground">
            No live market line available
          </p>
        )}
      </div>
      <div className="border-t border-card-rim px-3 py-2.5 text-sm leading-relaxed">
        {streaming ? (
          <span className="animate-pulse">
            <AssistantMarkdown content={content} />
          </span>
        ) : (
          <AssistantMarkdown content={content} />
        )}
        <div className="mt-2 flex items-center gap-2">
          <GroundingBadge grounding={grounding} />
          {streaming && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              streaming
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CompactMatchContext({ grounding }: { grounding: MatchGrounding }) {
  const rows = marketRowsFromGrounding(grounding);
  return (
    <details
      data-testid="compact-match-context"
      data-fixture-id={grounding.fixtureId}
      className="group mb-2 rounded-md border border-border/70 bg-secondary/20 px-2.5 py-1.5"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground marker:hidden">
        <span aria-hidden="true" className="inline-block text-[10px] transition-transform group-open:rotate-90">▶</span>
        <span className="font-medium text-foreground">{grounding.home} vs {grounding.away}</span>
        <span>· Match context</span>
        <span className="sr-only"> (expand forecast and market details)</span>
      </summary>
      <div className="mt-2 border-t border-border/60 pt-2">
        <ProbabilityBar pHome={grounding.pHome} pDraw={grounding.pDraw} pAway={grounding.pAway} size="sm" />
        <div className="mt-1 grid grid-cols-3 font-mono text-[10px] text-muted-foreground">
          <span className="text-primary"><span className="sr-only">{grounding.home} win </span>{formatPercent(grounding.pHome)}</span>
          <span className="text-center"><span className="sr-only">Draw </span>{formatPercent(grounding.pDraw)}</span>
          <span className="text-right text-accent"><span className="sr-only">{grounding.away} win </span>{formatPercent(grounding.pAway)}</span>
        </div>
        {rows.length > 1 && (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {rows.slice(1).map((row) => (
              `${row.label}${row.observedAt ? ` · ${formatObservedAt(row.observedAt)}` : ""}`
            )).join(" · ")}
          </p>
        )}
      </div>
    </details>
  );
}

export function HomeChat() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const [loadingTier, setLoadingTier] = useState<LoadingTier>(null);
  const [teamContext, setTeamContext] = useState<TeamContext>();
  const [fixtureContext, setFixtureContext] = useState<FixtureContext>();
  const [fixtureContextTeams, setFixtureContextTeams] = useState<TeamContext>();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [fixtureState, setFixtureState] = useState<FixtureState>("loading");
  const [stopNotice, setStopNotice] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoAskedRef = useRef<string | null>(null);
  const askRef = useRef<(
    question: string,
    fixtureContext?: FixtureContext,
    userLine?: UserLine
  ) => Promise<void>>(async () => undefined);
  const streamingIdRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const activeRequestRef = useRef<{
    requestId: number;
    controller: AbortController;
    userId: number;
    assistantId: number;
    prompt: string;
    teamContext?: TeamContext;
    fixtureContext?: FixtureContext;
    userLine?: UserLine;
    stopped: boolean;
  } | null>(null);
  const stoppedDraftRef = useRef<{
    prompt: string;
    teamContext?: TeamContext;
    fixtureContext?: FixtureContext;
    userLine?: UserLine;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current?.controller.abort();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [model, active] = await Promise.all([
          fetchActiveModelFixtures(),
          fetchActiveFixtures(),
        ]);
        if (cancelled) return;
        const espnById = espnStatusByIdentity(active.matches);
        const upcomingPriced = model.fixtures.filter((fixture) => (
          isFutureScheduledFixture(
            fixture.utcDate,
            espnById.get(modelFixtureIdentity(fixture)) ?? fixture.status
          )
        ));
        const featured = upcomingPriced.slice(0, 3);
        if (featured.length > 0) {
          // Every suggested fixture comes from the model, so each one grounds.
          // A model error alongside them means other fixtures went unpriced.
          // In-play and finished stay priced on /model; they are not "upcoming".
          setFixtureState(model.error ? "partial" : "ready");
          setSuggestions(featuredDeskSuggestions(featured));
          return;
        }

        if (model.fixtures.length > 0) {
          // Priced fixtures exist, but none are still SCHEDULED in the future.
          setFixtureState(model.error ? "partial" : "ready");
          setSuggestions(NO_FIXTURE_SUGGESTIONS);
          return;
        }

        // Nothing is priced. Suggesting the raw fixture list here is what
        // produced chips that answered 503, so fall back to prompts that work
        // without the match model in every one of these cases.
        setSuggestions(NO_FIXTURE_SUGGESTIONS);
        if (active.matches.length > 0) {
          setFixtureState("unpriced");
        } else if (active.error || model.error) {
          // These wrappers report a transport failure on `error` rather than
          // throwing, so without this check an unreachable API is indistinguishable
          // from an empty window and gets announced as "no fixtures scheduled".
          setFixtureState("unavailable");
        } else {
          setFixtureState("no-fixtures");
        }
      } catch {
        if (!cancelled) {
          // An endpoint failed, so whether fixtures exist is unknown.
          setFixtureState("unavailable");
          setSuggestions(NO_FIXTURE_SUGGESTIONS);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // `chipFixtureContext` is the identity of a clicked suggestion. It overrides
  // the followed fixture for that turn so a chip opens the fixture it shows
  // rather than continuing whatever was in context.
  async function ask(
    question: string,
    chipFixtureContext?: FixtureContext,
    chipUserLine?: UserLine
  ) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const history = completedHistory(messages);
    const userId = nextId++;
    const assistantId = nextId++;
    const reuseStoppedDraft = stoppedDraftRef.current?.prompt === trimmed;
    const requestTeamContext = chipFixtureContext
      ? undefined
      : (reuseStoppedDraft ? stoppedDraftRef.current?.teamContext : teamContext);
    const requestFixtureContext = chipFixtureContext
      ?? (reuseStoppedDraft ? stoppedDraftRef.current?.fixtureContext : fixtureContext);
    const requestUserLine = chipUserLine
      ?? (reuseStoppedDraft ? stoppedDraftRef.current?.userLine : undefined);
    const activeRequest = {
      requestId: requestIdRef.current++,
      controller: new AbortController(),
      userId,
      assistantId,
      prompt: trimmed,
      teamContext: requestTeamContext,
      fixtureContext: requestFixtureContext,
      userLine: requestUserLine,
      stopped: false,
    };
    activeRequestRef.current = activeRequest;
    stoppedDraftRef.current = null;

    setMessages((prev) => [...prev, { id: userId, role: "user", content: trimmed }]);
    setInput("");
    setStopNotice("");
    setLoading(true);
    setStreamStarted(false);
    setLoadingTier(null);

    let started = false;
    let streamedGrounding: AskGrounding = null;
    const ownsRequest = () =>
      mountedRef.current && activeRequestRef.current?.requestId === activeRequest.requestId;
    const requestIsLive = () => ownsRequest() && !activeRequest.stopped;

    try {
      const { answer, grounding, presentation } = await askQuestionStream(
        trimmed,
        history,
        requestTeamContext,
        requestFixtureContext,
        requestUserLine,
        {
        onGrounding: (initialGrounding) => {
          if (!requestIsLive()) return;
          streamedGrounding = initialGrounding;
          setLoadingTier(
            initialGrounding?.kind === "match"
              ? "match"
              : initialGrounding?.kind === "fixture"
                ? "fixture"
              : initialGrounding?.kind === "season"
                ? "season"
                : initialGrounding?.kind === "competition"
                  ? "competition"
                  : "general"
          );
        },
        onDelta: (text) => {
          if (!requestIsLive()) return;
          if (!started) {
            started = true;
            setStreamStarted(true);
            streamingIdRef.current = assistantId;
            setMessages((prev) => [
              ...prev,
              { id: assistantId, role: "assistant", content: text, grounding: streamedGrounding },
            ]);
          } else {
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + text } : m
            ));
          }
        },
        },
        activeRequest.controller.signal
      );
      if (!requestIsLive()) return;
      // A competition or general answer does not establish a new match, but it
      // does not end the one under discussion either. Keeping the context lets
      // a later follow-up resolve back to that match instead of dropping to the
      // general tier; the API releases it once another team is named, and "New
      // Chat" clears it outright.
      if (grounding?.kind === "match") {
        setTeamContext([grounding.home, grounding.away]);
        setFixtureContext({ fixtureId: grounding.fixtureId });
        setFixtureContextTeams([grounding.home, grounding.away]);
      } else if (grounding?.kind === "fixture") {
        setFixtureContext({ fixtureId: grounding.fixture.fixtureId });
        setFixtureContextTeams([
          grounding.fixture.homeTeam.name,
          grounding.fixture.awayTeam.name,
        ]);
      }
      setMessages((prev) => {
        const finalMessage: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: answer,
          grounding,
          presentation,
        };
        return started
          ? prev.map((m) => (m.id === assistantId ? finalMessage : m))
          : [...prev, finalMessage];
      });
    } catch (err) {
      if (!ownsRequest()) return;
      if (activeRequest.stopped || activeRequest.controller.signal.aborted) {
        setMessages((prev) => prev.filter((m) => m.id !== userId && m.id !== assistantId));
        return;
      }
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== assistantId),
        { id: nextId++, role: "error", content: sanitizeAskError(err) },
      ]);
    } finally {
      if (activeRequestRef.current?.requestId !== activeRequest.requestId) return;
      activeRequestRef.current = null;
      if (!mountedRef.current) return;
      streamingIdRef.current = null;
      setLoading(false);
      setStreamStarted(false);
      setLoadingTier(null);
    }
  }

  askRef.current = ask;

  function stopGenerating() {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest || !mountedRef.current) return;

    activeRequest.stopped = true;
    stoppedDraftRef.current = {
      prompt: activeRequest.prompt,
      teamContext: activeRequest.teamContext,
      fixtureContext: activeRequest.fixtureContext,
      userLine: activeRequest.userLine,
    };
    activeRequest.controller.abort();
    setMessages((prev) => prev.filter((m) =>
      m.id !== activeRequest.userId && m.id !== activeRequest.assistantId
    ));
    setInput(activeRequest.prompt);
    setStopNotice("Response stopped.");
  }

  useEffect(() => {
    let cancelled = false;
    const query = searchParams.get("q")?.trim();
    const fixtureId = searchParams.get("fixture");
    const autoAskKey = `${query ?? ""}\u0000${fixtureId ?? ""}`;
    if (!query || query.length > 500 || autoAskedRef.current === autoAskKey) return;
    // The URL value is only an opaque address. The API resolves it against
    // server-owned fixture data; do not infer trusted teams in the browser.
    queueMicrotask(() => {
      if (cancelled || !mountedRef.current || autoAskedRef.current === autoAskKey) return;
      autoAskedRef.current = autoAskKey;
      void askRef.current(query, fixtureId ? { fixtureId } : undefined);
    });
    return () => { cancelled = true; };
  }, [searchParams]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    ask(input);
  }

  function startNewChat() {
    setMessages([]);
    setInput("");
    setStopNotice("");
    stoppedDraftRef.current = null;
    setTeamContext(undefined);
    setFixtureContext(undefined);
    setFixtureContextTeams(undefined);
    autoAskedRef.current = null;
    if (searchParams.get("q") || searchParams.get("fixture")) {
      router.replace("/", { scroll: false });
    }
  }

  // Status bar state — derives a small modelState from existing signals without
  // any new fetches. Keeps the bar live off readiness/loading without touching
  // the `ask()` flow.
  const modelState = loadingTier === "match" ? "loading" : fixtureState;
  const statusTone = modelState === "loading" || modelState === "partial"
    ? "bg-amber-300"
    : modelState === "ready"
      ? "bg-primary"
      : "bg-slate-500";
  const statusLabel = ((): string => {
    switch (modelState) {
      case "loading":
        return loadingTier
          ? `Loading match model — ${loadingMessage(loadingTier)}`
          : "Loading match model";
      case "ready":
        return "Match forecasts ready · active fixtures live";
      case "partial":
        // Claiming a clean "Model grounded" here is what made an unpriced
        // fixture answer 503 with no warning.
        return "Match forecasts ready for some fixtures — a few aren't priced yet";
      case "unpriced":
        return "Match model is catching up — table, title race, and general questions still work";
      case "no-fixtures":
        // Between rounds nothing is broken, so this must not read as a fault.
        return "No fixtures scheduled — table, title race, and general questions still work";
      default:
        return "Model not ready — table and general questions still work";
    }
  })();
  const inputStatus = modelState === "loading"
    ? "loading"
    : modelState === "ready"
      ? "ready"
      : "cold";
  const hasUpcomingFixtureChips = suggestions.some((suggestion) => suggestion.fixtureContext);
  const emptyStatePrompt = fixtureState === "loading"
    ? "Ask me about a Premier League or UCL qualifier match, the table, or the title race."
    : (fixtureState === "ready" || fixtureState === "partial") && hasUpcomingFixtureChips
      ? "Ask me about an upcoming Premier League or UCL qualifier match for a grounded forecast."
      : "Ask me about the Premier League table, the title race, or football in general.";

  // Older API releases do not send presentation hints. In that case, render
  // one full card for the first answer about each fixture and keep later turns
  // compact. A V2 response can explicitly request expanded/compact/none.
  const expandedMatchMessageIds = new Set<number>();
  const fixturesWithFullCard = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || message.grounding?.kind !== "match") continue;
    // The presentation directive arrives in the authoritative done event.
    // While the first turn is streaming, keep its context compact rather than
    // flashing a full card that a later `none` directive immediately removes.
    if (
      streamStarted
      && message.id === streamingIdRef.current
      && !message.presentation
    ) continue;
    const directive = message.presentation?.fixtureCard;
    if (directive === "expanded" && !fixturesWithFullCard.has(message.grounding.fixtureId)) {
      expandedMatchMessageIds.add(message.id);
      fixturesWithFullCard.add(message.grounding.fixtureId);
    } else if (!directive && !fixturesWithFullCard.has(message.grounding.fixtureId)) {
      expandedMatchMessageIds.add(message.id);
      fixturesWithFullCard.add(message.grounding.fixtureId);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-2.75rem)] max-w-2xl flex-col px-4">
      {messages.length > 0 && (
        <div className="flex items-center justify-end gap-2 pt-3">
          {fixtureContextTeams && (
            <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              Following: {fixtureContextTeams[0]} vs {fixtureContextTeams[1]}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={loading}
            onClick={startNewChat}
          >
            New Chat
          </Button>
        </div>
      )}
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-start pt-[14vh] text-center sm:justify-center sm:pt-0">
          <div className="space-y-3">
            <h1
              className="font-mono text-xs font-normal uppercase tracking-[0.2em] text-muted-foreground"
            >
              <span className="text-white">Pundit</span>
              <span className="mx-1.5 text-muted-foreground/60">·</span>
              <span>v0.3</span>
              <span className="mx-1.5 text-muted-foreground/60">·</span>
              <span>Premier League</span>
              <span className="mx-1.5 text-muted-foreground/60">·</span>
              <span>UCL qualifiers</span>
            </h1>
            <h2
              data-display="true"
              className="font-display text-5xl font-normal leading-tight text-white sm:text-6xl"
            >
              Football analysis, grounded.
            </h2>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
              {emptyStatePrompt}
            </p>
          </div>
          {fixtureState === "partial" && (
            <p className="mt-4 max-w-md text-xs text-muted-foreground">
              A few fixtures in this window aren&apos;t priced yet, so the model can&apos;t read
              those matchups. The suggestions below are all covered.
            </p>
          )}
          {fixtureState === "unpriced" && (
            <p className="mt-4 max-w-md text-xs text-muted-foreground">
              Fixtures are scheduled, but the model hasn&apos;t priced them yet — match reads
              return once it catches up. Table, title-race, and general questions still work.
            </p>
          )}
          {fixtureState === "no-fixtures" && (
            <p className="mt-4 max-w-md text-xs text-muted-foreground">
              No Premier League or UCL qualifier fixtures in the next 14 days. Match-grounded reads
              return with the next scheduled round — until then, table, title-race, and general
              questions all still work.
            </p>
          )}
          {fixtureState === "unavailable" && (
            <p className="mt-4 max-w-md text-xs text-muted-foreground">
              Couldn&apos;t load the fixture list just now — table and general questions still work.
            </p>
          )}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div
            aria-live="polite"
            aria-relevant="additions text"
            className="flex flex-col gap-3 py-4"
          >
            {messages.map((m) => {
              const isMatchCard = m.role === "assistant"
                && m.grounding?.kind === "match"
                && expandedMatchMessageIds.has(m.id);
              const streaming = streamStarted && m.id === streamingIdRef.current;
              if (isMatchCard && m.grounding?.kind === "match") {
                return (
                  <MatchFixtureCard
                    key={m.id}
                    content={m.content}
                    grounding={m.grounding}
                    streaming={streaming}
                  />
                );
              }
              const precedingUser = [...messages]
                .slice(0, messages.indexOf(m))
                .reverse()
                .find((msg) => msg.role === "user");
              return (
                <div
                  key={m.id}
                  role={m.role === "error" ? "alert" : undefined}
                  className={cn(
                    "max-w-[85%] rounded-lg border px-4 py-2.5 text-sm leading-relaxed",
                    m.role === "user" &&
                      "ml-auto border-card-rim bg-card text-foreground",
                    m.role === "assistant" &&
                      "mr-auto border-card-rim bg-card text-foreground",
                    m.role === "error" &&
                      "mr-auto border-destructive/30 bg-destructive/10 text-destructive-foreground"
                  )}
                >
                  {m.role === "assistant" && (
                    <div className="mb-2">
                      <GroundingBadge grounding={m.grounding ?? null} />
                    </div>
                  )}
                  {m.role === "assistant"
                    && m.grounding?.kind === "match"
                    && m.presentation?.fixtureCard !== "none" && (
                      <CompactMatchContext grounding={m.grounding} />
                    )}
                  {m.role === "assistant"
                    ? (
                      streaming ? (
                        <span className="animate-pulse">
                          <AssistantMarkdown content={m.content} />
                        </span>
                      ) : (
                        <AssistantMarkdown content={m.content} />
                      )
                    )
                    : <div>{m.content}</div>}
                  {m.role === "assistant" && streaming && (
                    <div className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                      {loadingMessage(loadingTier)}
                    </div>
                  )}
                  {m.role === "assistant" && (
                    <MessageActions
                      content={m.content}
                      question={precedingUser?.content ?? null}
                      fixtureId={
                        m.grounding?.kind === "fixture"
                          ? m.grounding.fixture.fixtureId
                          : m.grounding?.kind === "match"
                            ? m.grounding.fixtureId
                          : undefined
                      }
                    />
                  )}
                </div>
              );
            })}
            {loading && !streamStarted && (
              <div className="mr-auto flex items-center gap-1.5 rounded-lg border border-card-rim bg-card px-4 py-2.5 text-sm text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                {loadingMessage(loadingTier)}
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-1.5 border-t border-border py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {/* Status bar — 1px strip above the input row, color tracks model state */}
        <div
          aria-hidden
          className={cn(
            "h-px w-full transition-colors",
            statusTone
          )}
        />
        <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 truncate">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                statusTone,
                modelState === "ready" && "animate-pulse"
              )}
            />
            <span data-testid="chat-status">{statusLabel}</span>
          </span>
          {fixtureContextTeams && (
            <span className="min-w-0 truncate text-muted-foreground/70">
              Following: {fixtureContextTeams[0]} vs {fixtureContextTeams[1]}
            </span>
          )}
        </div>
        {messages.length === 0 && fixtureState !== "loading" && suggestions.length > 0 && (
          <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
            {suggestions.map((s) => (
              <button
                key={s.text}
                type="button"
                data-testid="suggestion-chip"
                data-has-user-line={s.userLine ? "true" : "false"}
                onClick={() => ask(s.text, s.fixtureContext, s.userLine)}
                className={cn(
                  "snap-start shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                )}
              >
                {s.text}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => {
              stoppedDraftRef.current = null;
              setInput(e.target.value);
            }}
            placeholder="Ask about a match or the Premier League table"
            disabled={loading}
            maxLength={500}
            aria-label="Ask a question"
            status={inputStatus}
          />
          {loading ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                stopGenerating();
              }}
              aria-label="Stop generating"
            >
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              variant="mono"
              size="icon"
              disabled={!input.trim()}
              aria-label="Send"
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {stopNotice}
        </div>
        <Disclaimer className="text-center text-xs text-muted-foreground" />
        {messages.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            <Link
              href="/fixtures"
              className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              View Fixtures
            </Link>
            <span className="mx-1.5 text-muted-foreground/60">·</span>
            <Link
              href="/model"
              className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Model Reference
            </Link>
            {getDocsUrl() && (
              <>
                <span className="mx-1.5 text-muted-foreground/60">·</span>
                <a
                  href={getDocsUrl()!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  Learn more
                </a>
              </>
            )}
          </p>
        ) : (
          getDocsUrl() && (
            <p className="text-center text-xs text-muted-foreground">
              <a
                href={getDocsUrl()!}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                Learn more
              </a>
            </p>
          )
        )}
      </form>
    </div>
  );
}
