import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptLocomo, DEFAULT_DATASET_PATH, loadDatasetFile, parseDataset } from "./load";

const valid = {
  name: "tiny",
  conversations: [{ id: "c1", sessions: [{ turns: [{ speaker: "A", text: "hello" }] }] }],
  questions: [
    { id: "q1", conversationId: "c1", question: "What?", answer: "hello", category: "single" },
  ],
};

describe("eval dataset loader", () => {
  test("parses a minimally valid internal dataset", () => {
    expect(parseDataset(valid)).toEqual(valid);
  });

  test("loads the shipped smoke fixture", async () => {
    const dataset = await loadDatasetFile(DEFAULT_DATASET_PATH);
    expect(dataset.name).toBe("smoke");
    expect(dataset.conversations).toHaveLength(2);
    expect(dataset.questions).toHaveLength(6);
    const conversations = new Set(dataset.conversations.map((entry) => entry.id));
    for (const question of dataset.questions) {
      expect(conversations.has(question.conversationId)).toBe(true);
    }
  });

  test.each([
    ["missing name", { ...valid, name: "" }],
    ["no conversations", { ...valid, conversations: [] }],
    ["empty session", { ...valid, conversations: [{ id: "c1", sessions: [{ turns: [] }] }] }],
    ["missing answer", { ...valid, questions: [{ ...valid.questions[0], answer: undefined }] }],
    [
      "duplicate question id",
      {
        ...valid,
        questions: [valid.questions[0], { ...valid.questions[0], question: "Again?" }],
      },
    ],
    [
      "unknown conversation",
      { ...valid, questions: [{ ...valid.questions[0], conversationId: "nope" }] },
    ],
  ])("rejects %s", (_name, raw) => {
    expect(() => parseDataset(raw, "test")).toThrow(/Invalid eval dataset test/);
  });

  test("rejects non-JSON input through the file loader", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memtavi-eval-"));
    try {
      const path = join(directory, "invalid.json");
      await Bun.write(path, "{not json");
      await expect(loadDatasetFile(path)).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("locomo adapter", () => {
  const sample = {
    sample_id: "conv-1",
    conversation: {
      speaker_a: "Alice",
      speaker_b: "Bob",
      session_2: [{ speaker: "Bob", text: "second session" }],
      session_1: [
        { speaker: "Alice", text: "first turn" },
        { speaker: "Bob", text: "second turn" },
      ],
      session_1_date_time: "2026-01-01",
    },
    qa: [
      { question: "Who spoke first?", answer: "Alice", category: 4 },
      { question: "What is missing?", answer: 42, category: 2 },
      { question: "No answer here", category: 1 },
    ],
  };

  test("maps sessions in numeric order and labels categories", () => {
    const dataset = adaptLocomo([sample]);
    expect(dataset.name).toBe("locomo");
    expect(dataset.conversations).toHaveLength(1);
    expect(dataset.conversations[0]?.sessions).toHaveLength(2);
    expect(dataset.conversations[0]?.sessions[0]?.turns[0]).toEqual({
      speaker: "Alice",
      text: "first turn",
    });
    expect(dataset.questions).toHaveLength(2);
    expect(dataset.questions[0]).toEqual({
      id: "conv-1-q1",
      conversationId: "conv-1",
      question: "Who spoke first?",
      answer: "Alice",
      category: "single-hop",
    });
    expect(dataset.questions[1]?.answer).toBe("42");
    expect(dataset.questions[1]?.category).toBe("temporal");
  });

  test("accepts a dictionary keyed by sample id and skips unusable samples", () => {
    const dataset = adaptLocomo({
      alpha: sample,
      empty: { sample_id: "empty", conversation: {}, qa: [] },
    });
    expect(dataset.conversations.map((entry) => entry.id)).toEqual(["conv-1"]);
    expect(dataset.questions).toHaveLength(2);
  });

  test("rejects a file with no usable questions", () => {
    expect(() => adaptLocomo([{ sample_id: "x", conversation: {}, qa: [] }])).toThrow(
      /no usable questions/,
    );
  });
});
