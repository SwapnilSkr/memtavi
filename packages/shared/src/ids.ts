const prefixes = {
  brain: "brn",
  source: "src",
  page: "pg",
  connection: "cnn",
  change: "chg",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefixes[kind]}_${hex}`;
}
