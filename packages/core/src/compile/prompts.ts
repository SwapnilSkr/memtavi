import { createHash } from "node:crypto";
import extract from "../../../llm/prompts/extract.md" with { type: "text" };
import patch from "../../../llm/prompts/patch.md" with { type: "text" };

export { extract, patch };

export const prompts = Object.freeze({ extract, patch });
export type PromptName = keyof typeof prompts;

export function promptVersion(name: PromptName): string {
  return createHash("sha256").update(prompts[name], "utf8").digest("hex");
}
