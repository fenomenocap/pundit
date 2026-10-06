import type { AskGrounding, AskPresentation, AskResult, UserLine } from "@/lib/api";
import type { DeskChatTurn } from "./chat-history";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://thepundit.up.railway.app";
// The server has a 90-second deadline; allow five seconds for delivery.
const ASK_TIMEOUT_MS = 95_000;

export type ChatTurn = DeskChatTurn;

export async function askPundit({
  data,
  signal,
}: {
  signal?: AbortSignal;
  data: {
    question: string;
    history?: ChatTurn[];
    fixtureId?: string;
    userLine?: UserLine;
  };
}): Promise<{ ok: true; text: string; grounding: AskGrounding; presentation?: AskPresentation; sourceLabel?: "ESPN result" }> {
  const question = data.question.trim() || "Give me the weekend briefing.";
  if (question.length > 500) throw new Error("Questions must be 500 characters or fewer.");
  const history = data.history ?? [];
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ASK_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        history,
        fixtureContext: data.fixtureId ? { fixtureId: data.fixtureId } : undefined,
        ...(data.userLine ? { userLine: data.userLine } : {}),
        voice: "desk",
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `ask ${res.status}`);
    }
    const body = (await res.json()) as AskResult;
    controller.signal.throwIfAborted();
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    if (!answer) throw new Error("Pundit returned an empty answer. Try again.");
    const resultSource = body.grounding === null && body.verification?.status === "verified"
      && body.verification.supportedClaimCount > 0 && body.citations?.some((citation) => {
        try {
          const url = new URL(citation.url);
          return url.protocol === "https:" && ["espn.com", "www.espn.com"].includes(url.hostname)
            && /^\/soccer\/match\/_\/gameId\/[1-9]\d*$/.test(url.pathname)
            && /^\d{4}-\d{2}-\d{2}$/.test(citation.date)
            && Number.isFinite(Date.parse(citation.date))
            && answer.includes(`](${citation.url})`);
        } catch { return false; }
      });
    return {
      ok: true,
      text: answer,
      grounding: body.grounding ?? null,
      presentation: body.presentation,
      ...(resultSource ? { sourceLabel: "ESPN result" as const } : {}),
    };
  } catch (error) {
    if (timedOut) throw new Error("Pundit took too long to answer. Your question is ready to retry.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
