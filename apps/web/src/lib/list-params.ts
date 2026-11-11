import type { PageStatus } from "./api";

export const pageStatuses = ["active", "stale", "contested", "deprecated", "archived"] as const;

export function parseOffset(value: string | null): number {
  if (value === null || value === "") return 0;
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) return 0;
  return offset;
}

export function parsePageStatus(value: string | null): PageStatus | undefined {
  return pageStatuses.find((status) => status === value);
}

export function listSearchParams(
  status: PageStatus | undefined,
  offset: number,
): Record<string, string> {
  return {
    ...(status ? { status } : {}),
    ...(offset > 0 ? { offset: String(offset) } : {}),
  };
}
