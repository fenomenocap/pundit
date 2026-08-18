import Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";

/**
 * Stubs of the wire shapes `ask.ts` reads back from MiniMax's
 * Anthropic-compatible endpoint. Shared so every suite that drives the
 * generation and delivery chain speaks the same dialect: a stub that drifts
 * from the real payload shape lets a guard pass in tests and fail in
 * production, which is how the answer pipeline got into its current state.
 */

/** A response asking for one web search, as MiniMax returns it. */
export function toolUseMessage(text: string, id = "tool-1") {
  return {
    content: [
      { type: "text", text, citations: [] },
      { type: "tool_use", id, name: "web_search", input: { query: "arsenal team news" } },
    ],
    stop_reason: "tool_use",
  };
}

/** A client whose single `messages.create` always resolves to `response`. */
export function clientWith(response: unknown): Pick<Anthropic, "messages"> {
  return {
    messages: { create: vi.fn().mockResolvedValue(response) },
  } as unknown as Pick<Anthropic, "messages">;
}

/** A plain completed text response. */
export function message(text: string, stopReason: string) {
  return { content: [{ type: "text", text, citations: [] }], stop_reason: stopReason };
}

/**
 * Stub of the SDK's MessageStream: emits deltas on subscribe, then resolves
 * (or rejects) finalMessage.
 */
export function streamOf(final: unknown, deltas: string[] = [], error?: unknown) {
  return {
    on(event: string, handler: (text: string) => void) {
      if (event === "text") deltas.forEach(handler);
      return this;
    },
    finalMessage: () => (error ? Promise.reject(error) : Promise.resolve(final)),
  };
}
