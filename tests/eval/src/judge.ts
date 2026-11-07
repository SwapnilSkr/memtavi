const ARTICLES = new Set(["a", "an", "the"]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !ARTICLES.has(token))
    .join(" ");
}

export function tokenize(text: string): string[] {
  const normalized = normalize(text);
  return normalized.length > 0 ? normalized.split(" ") : [];
}

export function exactMatch(prediction: string, gold: string): boolean {
  return normalize(prediction) === normalize(gold);
}

function counts(tokens: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}

export function tokenF1(prediction: string, gold: string): number {
  const predicted = tokenize(prediction);
  const expected = tokenize(gold);
  if (predicted.length === 0 && expected.length === 0) return 1;
  if (predicted.length === 0 || expected.length === 0) return 0;

  const remaining = counts(expected);
  let overlap = 0;
  for (const token of predicted) {
    const available = remaining.get(token) ?? 0;
    if (available > 0) {
      overlap += 1;
      remaining.set(token, available - 1);
    }
  }
  if (overlap === 0) return 0;

  const precision = overlap / predicted.length;
  const recall = overlap / expected.length;
  return (2 * precision * recall) / (precision + recall);
}

export function judge(prediction: string, gold: string): { exact: boolean; f1: number } {
  return { exact: exactMatch(prediction, gold), f1: tokenF1(prediction, gold) };
}
