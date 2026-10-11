import { describe, expect, it } from "vitest";

import { calculateStats, percentile } from "../../src/results/stats.js";
import { createAttemptResult } from "../helpers/fixtures.js";

describe("percentile", () => {
  it("returns null for an empty list", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("returns the only value for a single-element list", () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it("returns the minimum at 0 and the maximum at 100", () => {
    expect(percentile([3, 1, 4, 2], 0)).toBe(1);
    expect(percentile([3, 1, 4, 2], 100)).toBe(4);
  });

  it("interpolates linearly between neighbouring values", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBeCloseTo(9.1);
  });

  it("does not depend on input order and does not mutate the input", () => {
    const values = [30, 10, 20];

    expect(percentile(values, 50)).toBe(20);
    expect(values).toEqual([30, 10, 20]);
  });

  it("throws a RangeError when the percentile is outside 0..100", () => {
    expect(() => percentile([1, 2, 3], -1)).toThrow(RangeError);
    expect(() => percentile([1, 2, 3], 101)).toThrow(RangeError);
  });
});

describe("calculateStats", () => {
  it("returns null for every metric when there are no results", () => {
    expect(calculateStats([])).toEqual({
      avg: null,
      p50: null,
      p90: null,
      p95: null,
      p99: null,
    });
  });

  it("calculates the average and percentiles of response times", () => {
    const results = [100, 200, 300].map((responseTime, index) =>
      createAttemptResult({ attempt: index + 1, responseTime })
    );

    const stats = calculateStats(results);

    expect(stats.avg).toBe(200);
    expect(stats.p50).toBe(200);
    expect(stats.p90).toBeCloseTo(280);
    expect(stats.p95).toBeCloseTo(290);
    expect(stats.p99).toBeCloseTo(298);
  });

  it("ignores response times that are not finite numbers", () => {
    const results = [
      createAttemptResult({ responseTime: 100 }),
      createAttemptResult({ responseTime: Number.NaN }),
      createAttemptResult({ responseTime: 300 }),
    ];

    expect(calculateStats(results).avg).toBe(200);
  });

  it("returns null metrics when no response time is finite", () => {
    const results = [createAttemptResult({ responseTime: Number.NaN })];

    expect(calculateStats(results).avg).toBeNull();
  });
});
