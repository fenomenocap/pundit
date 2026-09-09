import type { ChatMsg } from "./store";

export type DeskChatTurn = { role: "user" | "assistant"; content: string };

/** Only completed user/pundit pairs belong in `/api/ask` history. */
export function completedDeskHistory(messages: ChatMsg[]): DeskChatTurn[] {
  const turns: DeskChatTurn[] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user.role !== "user" || assistant.role !== "pundit") continue;
    const userText = user.text.trim();
    const assistantText = assistant.text.trim();
    if (!userText || !assistantText) continue;
    turns.push(
      { role: "user", content: userText },
      { role: "assistant", content: assistantText },
    );
    index += 1;
  }
  return turns.slice(-12);
}
