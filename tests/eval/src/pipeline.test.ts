import { describe, expect, test } from "bun:test";
import { sessionSourceText } from "./pipeline";
import type { Session } from "./types";

const dated: Session = {
  date: "1:56 pm on 8 May, 2023",
  turns: [
    { speaker: "Alice", text: "first turn" },
    { speaker: "Bob", text: "second turn" },
  ],
};

describe("session source text", () => {
  test("prepends the date line exactly once before the turns", () => {
    const text = sessionSourceText(dated);
    expect(text).toBe("Session date: 1:56 pm on 8 May, 2023\nAlice: first turn\nBob: second turn");
    const dateLines = text.split("\n").filter((line) => line.startsWith("Session date:"));
    expect(dateLines).toHaveLength(1);
    expect(text.indexOf("Session date:")).toBeLessThan(text.indexOf("Alice: first turn"));
  });

  test("adds nothing when the session has no date", () => {
    expect(sessionSourceText({ turns: dated.turns })).toBe("Alice: first turn\nBob: second turn");
  });
});
