export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function percentile(values: readonly number[], p: number, digits = 3): number | null {
  if (values.length === 0) return null;
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError("percentile expects p between 0 and 1");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (sorted.length - 1) * p;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sorted[lowerIndex] ?? sorted[0] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  const weight = rank - lowerIndex;
  return roundTo(lower + (upper - lower) * weight, digits);
}
