import type { Page } from "./api";

export function resolvePage<T extends Pick<Page, "id" | "slug">>(
  pages: readonly T[],
  pageId: string,
): T | undefined {
  return pages.find((page) => page.id === pageId);
}

export function versionTransition(fromVersion: number | null, toVersion: number): string {
  return `${fromVersion ?? "null"} → ${toVersion}`;
}

export function relativeTime(createdAt: string, now: number): string {
  const seconds = (new Date(createdAt).getTime() - now) / 1000;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ] as const) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return formatter.format(Math.trunc(seconds / size), unit);
    }
  }
  return "now";
}
