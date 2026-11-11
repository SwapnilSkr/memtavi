import type { ChatMessage } from "@memtavi/llm/provider";
import { z } from "zod";
import { prompts, promptVersion } from "../compile/prompts";

export const PROFILE_SUGGESTIONS_MIN_PAGES = 3;
export const PROFILE_SUGGESTIONS_INDEX_LIMIT = 40;
export const PROFILE_SUGGESTIONS_ESTIMATED_OUTPUT_TOKENS = 2048;

export const profileFields = [
  "whoTheyAre",
  "whatTheyDo",
  "focus",
  "goals",
  "currentProjects",
  "stuckOn",
  "vaultOrganization",
] as const;

export type ProfileText = Record<(typeof profileFields)[number], string>;
export interface ProfilePage {
  slug: string;
  title: string;
  summary: string;
}

export const profileSuggestionSchema = z.object({
  field: z.enum(profileFields),
  value: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({ slug: z.string(), title: z.string() })).min(1),
});

export const profileSuggestionsSchema = z.object({ items: z.array(z.unknown()) });
export type ProfileSuggestion = z.infer<typeof profileSuggestionSchema>;

export function buildProfileMessages(
  pages: readonly ProfilePage[],
  current: ProfileText,
): ChatMessage[] {
  return [
    { role: "system", content: prompts.profileSuggestions },
    {
      role: "user",
      content: JSON.stringify({
        untrustedData: {
          profile: Object.fromEntries(profileFields.map((field) => [field, current[field]])),
          pages: pages
            .slice(0, PROFILE_SUGGESTIONS_INDEX_LIMIT)
            .map(({ slug, title, summary }) => ({
              slug,
              title,
              summary,
            })),
        },
      }),
    },
  ];
}

export function parseProfileSuggestions(
  text: string,
  pages: readonly ProfilePage[],
  current: ProfileText,
): ProfileSuggestion[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const parsed = profileSuggestionsSchema.safeParse(json);
  if (!parsed.success) return [];
  const known = new Map(
    pages.slice(0, PROFILE_SUGGESTIONS_INDEX_LIMIT).map((page) => [page.slug, page]),
  );
  const items: ProfileSuggestion[] = [];
  for (const raw of parsed.data.items) {
    const candidate = profileSuggestionSchema.safeParse(raw);
    if (!candidate.success) continue;
    const item = candidate.data;
    if (item.value === current[item.field].trim()) continue;
    if (item.evidence.some(({ slug }) => !known.has(slug))) continue;
    const slugs = [...new Set(item.evidence.map(({ slug }) => slug))].sort();
    items.push({
      ...item,
      evidence: slugs.map((slug) => ({ slug, title: known.get(slug)?.title ?? "" })),
    });
  }
  return items.sort(
    (a, b) =>
      profileFields.indexOf(a.field) - profileFields.indexOf(b.field) ||
      b.confidence - a.confidence ||
      (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
  );
}

export function suggestProfile(
  pages: readonly ProfilePage[],
  current: ProfileText,
  model: string,
  text = "",
) {
  return {
    generatedBy: "model" as const,
    model,
    promptHash: promptVersion("profileSuggestions"),
    items:
      pages.length < PROFILE_SUGGESTIONS_MIN_PAGES
        ? []
        : parseProfileSuggestions(text, pages, current),
  };
}
