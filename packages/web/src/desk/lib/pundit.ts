import type { DeskChatTurn } from "./chat-history";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://thepundit.up.railway.app";

export type ChatTurn = DeskChatTurn;

export async function askPundit({
  data,
}: {
  data: { question: string; history?: ChatTurn[]; fixtureId?: string };
}): Promise<{ ok: true; text: string }> {
  const question = data.question.trim().slice(0, 500) || "Give me the weekend briefing.";
  const history = data.history ?? [];
  const res = await fetch(`${API_URL}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      history,
      fixtureContext: data.fixtureId ? { fixtureId: data.fixtureId } : undefined,
      voice: "desk",
      stream: false,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `ask ${res.status}`);
  }
  const body = (await res.json()) as { answer?: string };
  return { ok: true, text: body.answer?.trim() || question };
}
