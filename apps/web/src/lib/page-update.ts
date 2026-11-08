import type { Page, PageUpdate } from "./api";

export type PageFields = Pick<Page, "title" | "summary" | "body">;

export function buildPageUpdate(
  original: PageFields & Pick<Page, "version">,
  edited: PageFields,
): PageUpdate {
  const update: PageUpdate = { version: original.version };
  for (const field of ["title", "summary", "body"] as const) {
    if (edited[field] !== original[field]) update[field] = edited[field];
  }
  return update;
}
