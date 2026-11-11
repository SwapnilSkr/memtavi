import { expect, test } from "bun:test";
import { createFakeProvider } from "@memtavi/llm/fake";
import { buildConnectMessages, type ConnectionPair, parseConnectResult } from "./connect";
import { promptVersion } from "./prompts";

test("connect v1 golden batch retains three supported bands and drops noise", async () => {
  expect(promptVersion("connect")).toBe(
    "d0a687576661e29f76886eb8dabc564c945642e9c7dafce18a76c66da1877939",
  );
  const labels = [
    {
      strength: "strong",
      body: "Atlas cannot ship until Acme delivers its SDK.",
      reasoning: "Atlas shipping depends on Acme's SDK.",
    },
    {
      strength: "medium",
      body: "Acme's SDK and Atlas both use the billing API.",
      reasoning: "Both projects integrate the billing API.",
    },
    {
      strength: "weak",
      body: "The SDK team shares its release checklist with Atlas.",
      reasoning: "Atlas can reuse the SDK team's checklist.",
    },
    {
      strength: "noise",
      body: "Today's weather is sunny.",
      reasoning: "The weather has no supported relationship to the SDK.",
    },
  ];
  const pairs: ConnectionPair[] = labels.map((label, index) => ({
    pageA: {
      id: "pg_a",
      title: "Acme SDK",
      summary: "Billing API integration",
      body: "Acme delivers an SDK using the billing API and publishes its release checklist.",
    },
    pageB: { id: `pg_b${index}`, title: "Atlas", summary: "", body: label.body },
    similarity: 0.8,
  }));
  const provider = createFakeProvider({
    chatResponses: [
      JSON.stringify({
        connections: labels.map((label, index) => ({
          pageAId: "pg_a",
          pageBId: `pg_b${index}`,
          strength: label.strength,
          reasoning: label.reasoning,
        })),
      }),
    ],
  });
  const response = await provider.chat({
    model: "fake-connect-v1",
    temperature: 0,
    responseFormat: "json",
    messages: buildConnectMessages([...pairs].reverse()),
  });
  const result = parseConnectResult(response.text, pairs);
  expect(result.map(({ strength }) => strength)).toEqual(["strong", "medium", "weak"]);
  expect(result.map(({ reasoning }) => reasoning)).toEqual(
    labels.slice(0, 3).map((label) => label.reasoning),
  );
  expect(provider.calls).toHaveLength(1);
  process.stdout.write(
    `connect v1 fixture replay: 4/4 labels handled, 3/3 reasons retained, noise 1/1 dropped; semantic model accuracy unmeasured\n`,
  );
});
