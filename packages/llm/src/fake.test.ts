import { expect, test } from "bun:test";
import { createFakeProvider } from "./fake";
import { ProviderError } from "./provider";

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("expected a vector");
  return value;
}

test("embeddings are stable for the same text across calls and instances", async () => {
  const one = createFakeProvider({ dimensions: 16 });
  const two = createFakeProvider({ dimensions: 16 });

  const a = await one.embed(["alpha"]);
  const b = await one.embed(["alpha"]);
  const c = await two.embed(["alpha"]);

  expect(a.vectors[0]).toEqual(first(b.vectors));
  expect(a.vectors[0]).toEqual(first(c.vectors));
});

test("different text produces a different vector", async () => {
  const fake = createFakeProvider({ dimensions: 16 });
  const result = await fake.embed(["alpha", "beta"]);
  expect(result.vectors[0]).not.toEqual(first(result.vectors.slice(1)));
});

test("embeddings have the configured length and unit norm", async () => {
  const fake = createFakeProvider({ dimensions: 32 });
  const result = await fake.embed(["alpha", ""]);

  expect(result.dimensions).toBe(32);
  for (const vector of result.vectors) {
    expect(vector).toHaveLength(32);
    expect(Math.abs(norm(vector) - 1)).toBeLessThan(1e-9);
  }
});

test("uses 1536 dimensions and the fake model by default", async () => {
  const result = await createFakeProvider().embed(["alpha"]);
  expect(result.dimensions).toBe(1536);
  expect(result.vectors[0]).toHaveLength(1536);
  expect(result.model).toBe("fake-embedding");
});

test("queued chat responses come back in order", async () => {
  const fake = createFakeProvider();
  fake.queueChat("first", "second");

  const first = await fake.chat({ model: "m", messages: [{ role: "user", content: "one" }] });
  const second = await fake.chat({ model: "m", messages: [{ role: "user", content: "two" }] });

  expect(first.text).toBe("first");
  expect(second.text).toBe("second");
  expect(first.model).toBe("m");
  expect(first.usage.outputTokens).toBeGreaterThan(0);
});

test("a queued ChatResult is returned as queued", async () => {
  const fake = createFakeProvider();
  fake.queueChat({
    text: '{"ok":true}',
    model: "test/chat-model-0613",
    usage: { inputTokens: 4, outputTokens: 2 },
  });

  const result = await fake.chat({ model: "m", messages: [] });

  expect(result).toEqual({
    text: '{"ok":true}',
    model: "test/chat-model-0613",
    usage: { inputTokens: 4, outputTokens: 2 },
  });
});

test("chat responses can be seeded at construction", async () => {
  const fake = createFakeProvider({ chatResponses: ["seeded"] });
  expect((await fake.chat({ model: "m", messages: [] })).text).toBe("seeded");
});

test("an exhausted queue fails permanently instead of inventing a response", async () => {
  const fake = createFakeProvider();
  const error = await fake.chat({ model: "m", messages: [] }).catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(ProviderError);
  expect(error).toMatchObject({ code: "fake_exhausted", transient: false });
});

test("the call log records chat requests and embedding inputs", async () => {
  const fake = createFakeProvider({ dimensions: 4 });
  fake.queueChat("answer");

  const request = { model: "m", messages: [{ role: "user" as const, content: "hi" }] };
  await fake.chat(request);
  await fake.embed(["one", "two"]);

  expect(fake.calls).toHaveLength(2);
  expect(fake.calls[0]).toEqual({ kind: "chat", request });
  expect(fake.calls[1]).toEqual({ kind: "embed", texts: ["one", "two"] });
});

test("the call log keeps its own copy of the embedding inputs", async () => {
  const fake = createFakeProvider({ dimensions: 4 });
  const texts = ["one"];
  await fake.embed(texts);
  texts.push("two");
  expect(fake.calls[0]).toEqual({ kind: "embed", texts: ["one"] });
});

test("reset clears the queue and the log", async () => {
  const fake = createFakeProvider();
  fake.queueChat("answer");
  await fake.embed(["one"]);
  fake.reset();

  expect(fake.calls).toHaveLength(0);
  const error = await fake.chat({ model: "m", messages: [] }).catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: "fake_exhausted" });
});
