import { ApiError } from "./api";

export type DirectivesResult =
  | { valid: true; value: Record<string, unknown> }
  | { valid: false; message: string };

export function parseDirectives(text: string): DirectivesResult {
  if (!text.trim()) return { valid: true, value: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { valid: false, message: "Enter valid JSON, such as {}." };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, message: "Directives must be a JSON object, such as {}." };
  }
  return { valid: true, value: value as Record<string, unknown> };
}

export function profileSuggestionError(error: Error | null): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 429)
      return "Profile suggestion budget exceeded. Try again after your budget resets.";
    if (error.status === 503) return "Profile suggestions are unavailable. Retry later.";
    if (error.status === 502)
      return "The suggestion provider could not complete this request (502).";
  }
  return error.message;
}
