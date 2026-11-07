import { expect, test } from "bun:test";
import { chunkBody } from "./chunk";

test.each(["", " \r\n\t\n"])("empty input has no chunks: %j", (body) => {
  expect(chunkBody(body)).toEqual([]);
});

test.each([
  "  first\r\n\r\nsecond  \n \nlast\n",
  `${"a".repeat(1_800)}\n\n${"b".repeat(1_800)}`,
  `${"a".repeat(3_000)}\r\n\r\n${"b".repeat(3_000)}`,
  `${"a".repeat(2_999)}😀${"b".repeat(5_000)}`,
])("chunks cover the original body with deterministic valid offsets", (body) => {
  const chunks = chunkBody(body);
  expect(chunkBody(body)).toEqual(chunks);
  expect(chunks.map((chunk) => chunk.text).join("")).toBe(body);
  let end = 0;
  for (const chunk of chunks) {
    expect(chunk.charStart).toBe(end);
    expect(chunk.text).toBe(body.slice(chunk.charStart, chunk.charEnd));
    expect(chunk.text.length).toBeLessThanOrEqual(3_000);
    expect(new TextDecoder().decode(new TextEncoder().encode(chunk.text))).toBe(chunk.text);
    end = chunk.charEnd;
  }
  expect(end).toBe(body.length);
});

test("paragraphs that fit remain intact", () => {
  const first = `${"a".repeat(1_800)}\n\n`;
  const second = "b".repeat(1_800);
  expect(chunkBody(first + second).map((chunk) => chunk.text)).toEqual([first, second]);
});

test("paragraph separators do not split a paragraph at the target boundary", () => {
  const paragraph = "a".repeat(2_999);
  const chunks = chunkBody(`${paragraph}\n\nlast`);
  expect(chunks[0]?.text).toBe(paragraph);
  expect(chunks[1]?.text).toBe("\n\nlast");
});
