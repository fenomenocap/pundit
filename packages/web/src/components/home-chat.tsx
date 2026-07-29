"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import {
  ApiError,
  askQuestionStream,
  type AskGrounding,
  type ConversationTurn,
  type MatchResponse,
  type MatchGrounding,
  type ModelFixtureResponse,
  type TeamContext,
} from "@/lib/api";
import { fetchActiveFixtures, fetchActiveModelFixtures } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Disclaimer } from "@/components/disclaimer";
import { getDocsUrl } from "@/lib/site-links";

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "error";
  content: string;
  grounding?: AskGrounding;
}

type LoadingTier = "match" | "competition" | "season" | "general" | null;

let nextId = 0;

const FALLBACK_SUGGESTIONS = [
  "What does the current Premier League table show?",
  "Who has the best chance in the next UCL qualifier?",
];

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
      return "Pundit's match model is temporarily unavailable — competition and general questions still work.";
    }
    switch (err.status) {
      case 400:
        return "Couldn't understand that — try rephrasing your question.";
      case 404:
        return "No data for that matchup yet.";
      case 429:
        return "You're asking a lot at once — wait a moment and try again.";
      case 502:
      case 503:
      case 504:
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
      msg.includes("anthropic")
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
  if (tier === "competition") return "Loading standings…";
  if (tier === "season") return "Simulating season outlook…";
  return "Thinking…";
}

function competitionAbbr(competitionId: string, competition: string): string {
  if (competitionId === "eng.1") return "PL";
  if (competitionId.includes("champions")) return "UCL";
  return competition.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function formatSuggestionChip(fixture: ModelFixtureResponse): string {
  const day = new Date(fixture.utcDate).toLocaleDateString(undefined, { weekday: "short" });
  const abbr = competitionAbbr(fixture.competitionId, fixture.competition);
  return `${fixture.home} vs ${fixture.away} · ${abbr} · ${day}`;
}

function formatActiveFixtureChip(fixture: MatchResponse): string {
  const day = new Date(fixture.utcDate).toLocaleDateString(undefined, { weekday: "short" });
  const abbr = competitionAbbr(fixture.competitionId, fixture.competition);
  return `${fixture.homeTeam} vs ${fixture.awayTeam} · ${abbr} · ${day}`;
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

function oddsRows(grounding: MatchGrounding) {
  const rows: Array<{
    label: string;
    pHome: number;
    pDraw: number | null;
    pAway: number;
  }> = [];

  rows.push({
    label: "Model",
    pHome: grounding.pHome,
    pDraw: grounding.pDraw,
    pAway: grounding.pAway,
  });

  if (grounding.stakePHome !== null
    && grounding.stakePDraw !== null
    && grounding.stakePAway !== null) {
    rows.push({
      label: "Stake",
      pHome: grounding.stakePHome,
      pDraw: grounding.stakePDraw,
      pAway: grounding.stakePAway,
    });
  }

  rows.push(...grounding.oddsSources.map((source) => ({
    label: source.source === "kalshi" ? "Kalshi" : "Polymarket",
    pHome: source.pHome,
    pDraw: source.pDraw,
    pAway: source.pAway,
  })));
  return rows;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function groundingLabel(grounding: AskGrounding): string {
  if (grounding?.kind === "match") {
    return `${grounding.competition} · ${grounding.date} · Pundit model`;
  }
  if (grounding?.kind === "season") {
    return `${grounding.competition} · season outlook · Pundit model`;
  }
  if (grounding?.kind === "competition") {
    return `${grounding.competition} · ESPN table`;
  }
  return "General · no live model data";
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      allowedElements={["p", "strong", "em", "ul", "ol", "li", "br", "code"]}
      unwrapDisallowed
      components={{
        p: (props) => <p className="mb-2 last:mb-0" {...props} />,
        ul: (props) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0" {...props} />,
        ol: (props) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0" {...props} />,
        strong: (props) => <strong className="font-semibold text-white" {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageActions({
  content,
  question,
}: {
  content: string;
  question: string | null;
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
    const url = `${window.location.origin}/?q=${encodeURIComponent(question)}`;
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

export function HomeChat() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const [loadingTier, setLoadingTier] = useState<LoadingTier>(null);
  const [teamContext, setTeamContext] = useState<TeamContext>();
  const [suggestions, setSuggestions] = useState(FALLBACK_SUGGESTIONS);
  const [hasFeaturedFixtures, setHasFeaturedFixtures] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoAskedRef = useRef<string | null>(null);
  const askRef = useRef<(question: string) => Promise<void>>(async () => undefined);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { fixtures } = await fetchActiveModelFixtures();
        if (cancelled) return;
        const featured = fixtures.slice(0, 3).map(formatSuggestionChip);
        if (featured.length > 0) {
          setHasFeaturedFixtures(true);
          setSuggestions(featured);
          return;
        }

        const active = await fetchActiveFixtures();
        if (cancelled) return;
        const activeSuggestions = active.matches.slice(0, 3).map(formatActiveFixtureChip);
        const hasActive = activeSuggestions.length > 0;
        setHasFeaturedFixtures(hasActive);
        setSuggestions(hasActive ? activeSuggestions : FALLBACK_SUGGESTIONS);
      } catch {
        if (!cancelled) {
          setHasFeaturedFixtures(false);
          setSuggestions(FALLBACK_SUGGESTIONS);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const history = completedHistory(messages);
    const userId = nextId++;
    const assistantId = nextId++;

    setMessages((prev) => [...prev, { id: userId, role: "user", content: trimmed }]);
    setInput("");
    setLoading(true);
    setStreamStarted(false);
    setLoadingTier(null);

    let started = false;
    let streamedGrounding: AskGrounding = null;

    try {
      const { answer, grounding } = await askQuestionStream(trimmed, history, teamContext, {
        onGrounding: (initialGrounding) => {
          streamedGrounding = initialGrounding;
          setLoadingTier(
            initialGrounding?.kind === "match"
              ? "match"
              : initialGrounding?.kind === "season"
                ? "season"
                : initialGrounding?.kind === "competition"
                  ? "competition"
                  : "general"
          );
        },
        onDelta: (text) => {
          if (!started) {
            started = true;
            setStreamStarted(true);
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
      });
      // A competition or general answer does not establish a new match, but it
      // does not end the one under discussion either. Keeping the context lets
      // a later follow-up resolve back to that match instead of dropping to the
      // general tier; the API releases it once another team is named, and "New
      // Chat" clears it outright.
      if (grounding?.kind === "match") {
        setTeamContext([grounding.home, grounding.away]);
      }
      setMessages((prev) => {
        const finalMessage: ChatMessage = { id: assistantId, role: "assistant", content: answer, grounding };
        return started
          ? prev.map((m) => (m.id === assistantId ? finalMessage : m))
          : [...prev, finalMessage];
      });
    } catch (err) {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== assistantId),
        { id: nextId++, role: "error", content: sanitizeAskError(err) },
      ]);
    } finally {
      setLoading(false);
      setStreamStarted(false);
      setLoadingTier(null);
    }
  }

  askRef.current = ask;

  useEffect(() => {
    const query = searchParams.get("q")?.trim();
    if (!query || query.length > 500 || autoAskedRef.current === query) return;
    autoAskedRef.current = query;
    void askRef.current(query);
  }, [searchParams]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    ask(input);
  }

  function startNewChat() {
    setMessages([]);
    setInput("");
    setTeamContext(undefined);
    autoAskedRef.current = null;
    if (searchParams.get("q")) {
      router.replace("/", { scroll: false });
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-2.75rem)] max-w-2xl flex-col px-4">
      {messages.length > 0 && (
        <div className="flex items-center justify-end gap-2 pt-3">
          {teamContext && (
            <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              Following: {teamContext[0]} vs {teamContext[1]}
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
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <h1 className="font-heading text-3xl font-bold text-white sm:text-4xl">Pundit</h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Ask about upcoming Premier League or UCL qualifier matches for a read grounded in
            Pundit&apos;s statistical model.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
          {!hasFeaturedFixtures && (
            <p className="mt-4 max-w-md text-xs text-muted-foreground">
              No upcoming model fixtures — try a table question or general football analysis.
            </p>
          )}
          <div className="mt-8 flex items-center gap-3">
            <Link href="/fixtures">
              <Button size="sm">View Fixtures</Button>
            </Link>
            <Link href="/model">
              <Button variant="secondary" size="sm">Model Reference</Button>
            </Link>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div
            aria-live="polite"
            aria-relevant="additions text"
            className="flex flex-col gap-3 py-4"
          >
            {messages.map((m, index) => {
              const rows = m.role === "assistant" && m.grounding?.kind === "match"
                ? oddsRows(m.grounding)
                : [];
              const hasMarkets = rows.length > 1;
              const homeHeader = m.grounding?.kind === "match" ? teamAbbr(m.grounding.home) : "Home";
              const awayHeader = m.grounding?.kind === "match" ? teamAbbr(m.grounding.away) : "Away";
              const precedingUser = [...messages.slice(0, index)].reverse().find((msg) => msg.role === "user");
              return (
                <div
                  key={m.id}
                  role={m.role === "error" ? "alert" : undefined}
                  className={cn(
                    "max-w-[85%] rounded-lg border px-4 py-2.5 text-sm leading-relaxed",
                    m.role === "user" &&
                      "ml-auto border-primary/30 bg-primary/10 text-foreground",
                    m.role === "assistant" &&
                      "mr-auto border-border bg-card text-foreground",
                    m.role === "error" &&
                      "mr-auto border-destructive/30 bg-destructive/10 text-destructive-foreground"
                  )}
                >
                  {m.role === "assistant"
                    ? <AssistantMarkdown content={m.content} />
                    : <div>{m.content}</div>}
                  {m.role === "assistant" && (
                    <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {groundingLabel(m.grounding ?? null)}
                    </div>
                  )}
                  {rows.length > 0 && (
                    <div className="mt-2 border-t border-border/70 pt-2 text-xs leading-tight text-muted-foreground">
                      <div className="grid grid-cols-[minmax(4rem,1fr)_repeat(3,minmax(3rem,1fr))] gap-x-2 pb-1 font-medium uppercase tracking-wide sm:grid-cols-[minmax(5rem,1fr)_repeat(3,3rem)]">
                        <span>Market</span>
                        <span className="text-right">{homeHeader}</span>
                        <span className="text-right">Draw</span>
                        <span className="text-right">{awayHeader}</span>
                      </div>
                      {rows.map((row) => (
                        <div
                          key={row.label}
                          className="grid grid-cols-[minmax(4rem,1fr)_repeat(3,minmax(3rem,1fr))] gap-x-2 py-0.5 sm:grid-cols-[minmax(5rem,1fr)_repeat(3,3rem)]"
                        >
                          <span className="text-foreground/80">{row.label}</span>
                          <span className="text-right">{formatPercent(row.pHome)}</span>
                          <span className="text-right">{formatPercent(row.pDraw)}</span>
                          <span className="text-right">{formatPercent(row.pAway)}</span>
                        </div>
                      ))}
                      {!hasMarkets && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          No live market line available
                        </p>
                      )}
                    </div>
                  )}
                  {m.role === "assistant" && (
                    <MessageActions
                      content={m.content}
                      question={precedingUser?.content ?? null}
                    />
                  )}
                </div>
              );
            })}
            {loading && !streamStarted && (
              <div className="mr-auto flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
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
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a match or the Premier League table"
            disabled={loading}
            maxLength={500}
            aria-label="Ask a question"
          />
          <Button type="submit" disabled={loading || !input.trim()}>
            Send
          </Button>
        </div>
        <Disclaimer className="text-center text-xs text-muted-foreground" />
        {getDocsUrl() && (
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
        )}
      </form>
    </div>
  );
}
