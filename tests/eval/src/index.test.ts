import { describe, expect, test } from "bun:test";
import { buildReadBlock, buildSummaryIndex, type IndexPage, type ReadPage } from "./answer";
import { estimateTokens } from "./tokens";

const pages: IndexPage[] = [
  { id: "p1", slug: "alpha", title: "Alpha", summary: "one two three" },
  { id: "p2", slug: "beta", title: "Beta", summary: "four five six" },
];

describe("index budget", () => {
  test("estimates tokens at four characters each", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  test("builds a summaries-only index with deterministic order", () => {
    const index = buildSummaryIndex(pages, 1_000);
    expect(index.text).toBe("- one two three\n- four five six");
    expect(index.included).toBe(2);
    expect(index.skipped).toBe(0);
    expect(index.used).toBeLessThanOrEqual(1_000);
  });

  test("stops adding summaries at the token cap", () => {
    const firstLineTokens = estimateTokens("- one two three") + 1;
    const index = buildSummaryIndex(pages, firstLineTokens);
    expect(index.included).toBe(1);
    expect(index.skipped).toBe(1);
    expect(index.text).toBe("- one two three");
    expect(index.used).toBe(firstLineTokens);
  });

  test("includes nothing when the cap cannot hold one line", () => {
    const index = buildSummaryIndex(pages, 1);
    expect(index.text).toBe("");
    expect(index.included).toBe(0);
    expect(index.skipped).toBe(2);
    expect(index.used).toBe(0);
  });

  test("skips an oversized read page but keeps later ones that fit", () => {
    const readPages: ReadPage[] = [
      { id: "p1", title: "Huge", body: "x".repeat(4_000) },
      { id: "p2", title: "Small", body: "fits" },
    ];
    const block = buildReadBlock(readPages, 10);
    expect(block.included).toBe(1);
    expect(block.skipped).toBe(1);
    expect(block.text).toBe("### Small\nfits");
    expect(block.used).toBeLessThanOrEqual(10);
  });

  test("preserves rank order inside the read budget", () => {
    const readPages: ReadPage[] = [
      { id: "p1", title: "First", body: "alpha" },
      { id: "p2", title: "Second", body: "beta" },
      { id: "p3", title: "Third", body: "gamma" },
    ];
    const block = buildReadBlock(readPages, 1_000);
    expect(block.text.indexOf("First")).toBeLessThan(block.text.indexOf("Second"));
    expect(block.text.indexOf("Second")).toBeLessThan(block.text.indexOf("Third"));
    expect(block.included).toBe(3);
  });
});
