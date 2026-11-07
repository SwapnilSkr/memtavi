import type { ExtractedFact } from "../schemas";

export const MWS_WEIGHTS = Object.freeze({
  durability: 0.25,
  impact: 0.2,
  recurrence: 0.15,
  novelty: 0.1,
  futureUse: 0.2,
  confidence: 0.1,
});

export const MWS_DURABLE_THRESHOLD = 0.65;
export const MWS_PROVISIONAL_THRESHOLD = 0.35;
export const MWS_UNSUITABLE_PENALTY = 0.3;

export const MWS_RATIONALES = Object.freeze({
  durability: "Lasting claims receive the largest share of retention weight.",
  impact: "Consequential claims deserve durable recall.",
  recurrence: "Repeated relevance supports retention without dominating it.",
  novelty: "New information adds value but alone cannot justify retention.",
  futureUse: "Expected reuse matters as much as immediate impact.",
  confidence: "Evidence quality moderates utility without becoming a truth probability.",
  durableThreshold: "A score of at least 0.65 requires several strong retention signals.",
  provisionalThreshold: "A score of at least 0.35 preserves borderline material provisionally.",
  unsuitablePenalty: "Fully unsuitable material loses 0.30 of its retention score.",
});

export type MwsInput = Pick<ExtractedFact, keyof typeof MWS_WEIGHTS | "sensitivity"> & {
  unsuitableMaterial?: number;
};

export interface MwsConfig {
  unsuitablePenalty?: number;
}

export interface MwsDecision {
  band: "durable" | "provisional" | "source_only";
  score: number;
  reason: "sensitivity" | "score";
}

export function decideMws(input: MwsInput, config: MwsConfig = {}): MwsDecision {
  if (input.sensitivity === "secret" || input.sensitivity === "regulated") {
    return { band: "source_only", score: 0, reason: "sensitivity" };
  }
  const penalty = config.unsuitablePenalty ?? MWS_UNSUITABLE_PENALTY;
  const unsuitable = input.unsuitableMaterial ?? 0;
  if (
    !Number.isFinite(penalty) ||
    penalty < 0 ||
    unsuitable < 0 ||
    unsuitable > 1 ||
    !Number.isFinite(unsuitable)
  ) {
    throw new RangeError("Invalid unsuitable-material penalty");
  }
  let weighted = 0;
  for (const key of Object.keys(MWS_WEIGHTS).sort() as (keyof typeof MWS_WEIGHTS)[]) {
    const value = input[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError("MWS signals must be between zero and one");
    }
    weighted += value * MWS_WEIGHTS[key];
  }
  const score = Number(Math.max(0, Math.min(1, weighted - unsuitable * penalty)).toFixed(15));
  const band =
    score >= MWS_DURABLE_THRESHOLD
      ? "durable"
      : score >= MWS_PROVISIONAL_THRESHOLD
        ? "provisional"
        : "source_only";
  return { band, score, reason: "score" };
}
