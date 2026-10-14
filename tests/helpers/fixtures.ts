import type { CliOptions } from "../../src/cli/args.js";
import type { AttemptResult, TargetResult } from "../../src/results/types.js";
import type { Target } from "../../src/targets/types.js";

export function createCliOptions(
  overrides: Partial<CliOptions> = {}
): CliOptions {
  return {
    proxyUrl: null,
    reuseContext: false,
    browser: { name: "chromium", launchOptions: {} },
    targetSet: { name: "global", targets: [createTarget()] },
    ...overrides,
  };
}

export function createAttemptResult(
  overrides: Partial<AttemptResult> = {}
): AttemptResult {
  return {
    attempt: 1,
    status: 200,
    requestSuccess: true,
    contentSuccess: true,
    challenge: false,
    manualChallenge: false,
    responseTime: 100,
    finalUrl: "https://example.com/",
    title: "Example",
    error: null,
    ...overrides,
  };
}

export function createTarget(overrides: Partial<Target> = {}): Target {
  return {
    name: "Example",
    url: "https://example.com/",
    content: ["Example"],
    ...overrides,
  };
}

export function createTargetResult(
  overrides: Partial<TargetResult> = {}
): TargetResult {
  return {
    target: createTarget(),
    results: [createAttemptResult()],
    ...overrides,
  };
}
