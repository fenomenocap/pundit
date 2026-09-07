const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://thepundit.up.railway.app";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function askPundit({
  data,
}: {
  data: { messages: ChatTurn[]; fixtureId?: string };
}): Promise<{ ok: true; text: string }> {
  const messages = data.messages ?? [];
  const last = messages.at(-1)?.content?.trim() || "Give me the weekend briefing.";
  const history = messages.slice(0, -1);
  const res = await fetch(`${API_URL}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: last.slice(0, 500),
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
  return { ok: true, text: body.answer?.trim() || last };
}
