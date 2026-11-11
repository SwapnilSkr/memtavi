import type { PageVersionDiffLine } from "./api";

export interface DiffRow {
  key: string;
  op: PageVersionDiffLine["op"];
  text: string;
  marker: "+" | "−" | " ";
  label: "added" | "removed" | "unchanged";
}

const presentation = {
  context: { marker: " ", label: "unchanged" },
  add: { marker: "+", label: "added" },
  remove: { marker: "−", label: "removed" },
} as const satisfies Record<PageVersionDiffLine["op"], Pick<DiffRow, "marker" | "label">>;

export function diffRows(lines: readonly PageVersionDiffLine[]): DiffRow[] {
  return lines.map((line, position) => ({
    key: `${position}:${line.op}:${line.text}`,
    op: line.op,
    text: line.text,
    ...presentation[line.op],
  }));
}

export function orderedVersions(from: number, to: number): boolean {
  return Number.isInteger(from) && Number.isInteger(to) && from >= 1 && from < to;
}
