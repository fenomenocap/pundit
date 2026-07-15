import { describe, expect, it } from "vitest";
import { parseHistory } from "./ask";

describe("parseHistory", () => {
  it("accepts complete user/assistant exchanges", () => {
    expect(parseHistory([
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
    ])).toHaveLength(2);
  });

  it("rejects dangling turns and oversized total history", () => {
    expect(() => parseHistory([{ role: "user", content: "Question" }]))
      .toThrow(/complete user\/assistant/);
    const large = "x".repeat(3_001);
    expect(() => parseHistory(Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: large,
    })))).toThrow(/12000/);
  });
});
