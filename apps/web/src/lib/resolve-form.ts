import type { PageResolve } from "./api";

export function pageResolveBody(note: string, body: string): PageResolve | undefined {
  const trimmed = note.trim();
  if (!trimmed) return undefined;
  return body.trim() ? { note: trimmed, body } : { note: trimmed };
}
