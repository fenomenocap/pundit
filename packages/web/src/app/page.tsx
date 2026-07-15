"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import Link from "next/link";
import {
  ApiError,
  askQuestion,
  type AskGrounding,
  type ConversationTurn,
  type MatchGrounding,
  type TeamContext,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "error";
  content: string;
  grounding?: AskGrounding;
}

let nextId = 0;

const SUGGESTIONS = ["France vs Morocco", "Argentina vs Brazil", "USA vs England"];

function oddsRows(grounding: MatchGrounding) {
  const rows: Array<{
    label: string;
    pHome: number;
    pDraw: number | null;
    pAway: number;
  }> = [];

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

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [teamContext, setTeamContext] = useState<TeamContext>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const history: ConversationTurn[] = messages
      .filter((message): message is ChatMessage & { role: "user" | "assistant" } =>
        message.role !== "error"
      )
      .slice(-12)
      .map(({ role, content }) => ({ role, content }));

    setMessages((prev) => [...prev, { id: nextId++, role: "user", content: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const { answer, grounding } = await askQuestion(trimmed, history, teamContext);
      if (grounding?.kind === "match") {
        setTeamContext([grounding.home, grounding.away]);
      }
      setMessages((prev) => [
        ...prev,
        { id: nextId++, role: "assistant", content: answer, grounding },
      ]);
    } catch (err) {
      const serverMessage = err instanceof Error ? err.message : "Something went wrong.";
      const status = err instanceof ApiError ? err.status : undefined;
      const message = status === 400
        ? `Couldn't understand that — ${serverMessage}`
        : status === 404
          ? `No data for that matchup yet — ${serverMessage}`
          : status === 429
            ? "You're asking a lot at once — wait a moment and try again"
            : status === 502
              ? "Analysis service is temporarily unavailable — try again shortly"
              : serverMessage;
      setMessages((prev) => [...prev, { id: nextId++, role: "error", content: message }]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    ask(input);
  }

  function startNewChat() {
    setMessages([]);
    setInput("");
    setTeamContext(undefined);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-2.75rem)] max-w-2xl flex-col px-4">
      {messages.length > 0 && (
        <div className="flex justify-end pt-3">
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
            Ask about any World Cup 2026 matchup for a Dixon-Coles-Poisson-modelled
            read on the numbers.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-cyan-500/50 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mt-8 flex items-center gap-3">
            <Link
              href="/fixtures"
              className="rounded-md bg-cyan-500 px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-cyan-400"
            >
              View Fixtures
            </Link>
            <Link
              href="/model"
              className="rounded-md bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Model Reference
            </Link>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-3 py-4">
            {messages.map((m) => {
              const rows = m.role === "assistant" && m.grounding?.kind === "match"
                ? oddsRows(m.grounding)
                : [];
              return (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-lg border px-4 py-2.5 text-sm leading-relaxed",
                    m.role === "user" &&
                      "ml-auto border-cyan-500/30 bg-cyan-950/40 text-foreground",
                    m.role === "assistant" &&
                      "mr-auto border-border bg-card text-foreground",
                    m.role === "error" &&
                      "mr-auto border-pink-500/30 bg-pink-950 text-pink-200"
                  )}
                >
                  <div>{m.content}</div>
                  {rows.length > 0 && (
                    <div className="mt-2 border-t border-border/70 pt-2 text-[11px] leading-tight text-muted-foreground">
                      <div className="grid grid-cols-[minmax(5rem,1fr)_repeat(3,3rem)] gap-x-2 pb-1 font-medium uppercase tracking-wide">
                        <span>Market</span>
                        <span className="text-right">Home</span>
                        <span className="text-right">Draw</span>
                        <span className="text-right">Away</span>
                      </div>
                      {rows.map((row) => (
                        <div
                          key={row.label}
                          className="grid grid-cols-[minmax(5rem,1fr)_repeat(3,3rem)] gap-x-2 py-0.5"
                        >
                          <span className="text-foreground/80">{row.label}</span>
                          <span className="text-right">{formatPercent(row.pHome)}</span>
                          <span className="text-right">{formatPercent(row.pDraw)}</span>
                          <span className="text-right">{formatPercent(row.pAway)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {loading && (
              <div className="mr-auto flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                Thinking…
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border py-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a matchup, e.g. France vs Morocco"
          disabled={loading}
        />
        <Button type="submit" disabled={loading || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
