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
