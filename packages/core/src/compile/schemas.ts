import { z } from "zod";

const unitScore = z.number().min(0).max(1);

export const evidenceSpanSchema = z.object({
  chunkUuid: z.string().min(1),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  quote: z.string().min(1),
});

const extractedFactCandidateSchema = z
  .object({
    claim: z.string().min(1),
    kind: z.enum([
      "preference",
      "project_fact",
      "decision",
      "entity_attribute",
      "event",
      "commitment",
      "other",
    ]),
    entities: z.array(z.string().min(1)),
    validFrom: z.iso.datetime().optional(),
    validTo: z.iso.datetime().optional(),
    evidence: evidenceSpanSchema.optional(),
    confidence: unitScore,
    durability: unitScore,
    impact: unitScore,
    recurrence: unitScore,
    novelty: unitScore,
    futureUse: unitScore,
    sensitivity: z.enum(["none", "personal", "secret", "regulated"]),
  })
  .refine(
    ({ validFrom, validTo }) =>
      validFrom === undefined ||
      validTo === undefined ||
      Date.parse(validFrom) <= Date.parse(validTo),
    { message: "Validity window must be ordered" },
  );

export const extractedFactSchema = extractedFactCandidateSchema.safeExtend({
  evidence: evidenceSpanSchema,
});

export const extractionResultSchema = z.object({
  facts: z.array(extractedFactCandidateSchema),
});

export const patchResultSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  body: z.string(),
  changed: z.boolean(),
  contradictions: z.array(
    z.object({
      existingClaim: z.string().min(1),
      newClaim: z.string().min(1),
      evidence: evidenceSpanSchema,
    }),
  ),
});

const routeScores = { best: unitScore, second: unitScore, gap: unitScore };

export const routeDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("place"), pageId: z.string().min(1), ...routeScores }),
  z.object({
    action: z.literal("review"),
    candidateIds: z.array(z.string().min(1)).min(2),
    ...routeScores,
  }),
  z.object({ action: z.literal("new"), ...routeScores }),
]);

export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type PatchResult = z.infer<typeof patchResultSchema>;
export type RouteDecision = z.infer<typeof routeDecisionSchema>;
