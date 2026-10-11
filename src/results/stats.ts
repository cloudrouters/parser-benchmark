import type { AttemptResult, ResponseStats } from "./types.js";


export function percentile(
  values: readonly number[],
  percentileValue: number
): number | null {
  if (values.length === 0) {
    return null;
  }

  if (percentileValue < 0 || percentileValue > 100) {
    throw new RangeError("Percentile must be between 0 and 100.");
  }

  const sorted = [...values].sort((a, b) => a - b);

  const index = (percentileValue / 100) * (sorted.length - 1);

  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];

  if (lowerValue === undefined || upperValue === undefined) {
    throw new RangeError("Percentile index is outside of the sorted values.");
  }

  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

export function calculateStats(
  results: readonly AttemptResult[]
): ResponseStats {
  const responseTimes = results
    .map((result) => result.responseTime)
    .filter(Number.isFinite);

  if (responseTimes.length === 0) {
    return { avg: null, p50: null, p90: null, p95: null, p99: null };
  }

  const total = responseTimes.reduce((sum, value) => sum + value, 0);

  return {
    avg: total / responseTimes.length,
    p50: percentile(responseTimes, 50),
    p90: percentile(responseTimes, 90),
    p95: percentile(responseTimes, 95),
    p99: percentile(responseTimes, 99),
  };
}
