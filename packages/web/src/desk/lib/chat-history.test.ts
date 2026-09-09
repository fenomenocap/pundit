import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completedDeskHistory } from "./chat-history.ts";

describe("completedDeskHistory", () => {
  it("returns only completed user/pundit pairs", () => {
    const history = completedDeskHistory([
      { id: "1", role: "user", text: "First?", at: 1 },
      { id: "2", role: "pundit", text: "First answer.", at: 2 },
      { id: "3", role: "user", text: "Second?", at: 3 },
    ]);
    assert.deepEqual(history, [
      { role: "user", content: "First?" },
      { role: "assistant", content: "First answer." },
    ]);
  });

  it("drops a dangling user turn left by a failed ask", () => {
    const history = completedDeskHistory([
      { id: "1", role: "user", text: "Failed ask", at: 1 },
    ]);
    assert.deepEqual(history, []);
  });

  it("skips empty text and incomplete pairs", () => {
    const history = completedDeskHistory([
      { id: "1", role: "user", text: "   ", at: 1 },
      { id: "2", role: "pundit", text: "Answer", at: 2 },
      { id: "3", role: "user", text: "Good question", at: 3 },
      { id: "4", role: "pundit", text: "Good answer", at: 4 },
    ]);
    assert.deepEqual(history, [
      { role: "user", content: "Good question" },
      { role: "assistant", content: "Good answer" },
    ]);
  });
});
