import { stripVTControlCharacters } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOutput,
  formatAttemptResult,
  formatMs,
  formatPercent,
  formatRunHeader,
  formatSummary,
  renderTable,
} from "../../src/report/format.js";
import { cyan, green, red, yellow } from "../../src/shared/ansi.js";
import { CONFIG } from "../../src/shared/config.js";
import {
  createAttemptResult,
  createCliOptions,
  createTarget,
  createTargetResult,
} from "../helpers/fixtures.js";

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(66.6667)).toBe("67%");
    expect(formatPercent(100)).toBe("100%");
  });
});

describe("formatMs", () => {
  it("rounds milliseconds", () => {
    expect(formatMs(842.4)).toBe("842 ms");
    expect(formatMs(0)).toBe("0 ms");
  });

  it("renders a missing value as a dash", () => {
    expect(formatMs(null)).toBe("-");
  });
});

describe("renderTable", () => {
  it("draws a table whose columns fit the widest cell", () => {
    const table = renderTable(
      ["A", "Bb"],
      [
        ["1", "22"],
        ["333", "4"],
      ]
    );

    expect(table).toBe(
      [
        "┌─────┬────┐",
        "│ A   │ Bb │",
        "├─────┼────┤",
        "│ 1   │ 22 │",
        "│ 333 │ 4  │",
        "└─────┴────┘",
      ].join("\n")
    );
  });

  it("draws a table without rows", () => {
    expect(renderTable(["Name"], [])).toBe(
      ["┌──────┐", "│ Name │", "├──────┤", "└──────┘"].join("\n")
    );
  });
});

describe("formatAttemptResult", () => {
  it("describes a successful attempt on one line", () => {
    const line = formatAttemptResult(
      createAttemptResult({ attempt: 3, responseTime: 842, status: 200 })
    );

    expect(stripVTControlCharacters(line)).toBe(
      "Attempt 3/10 Request: OK | Challenge: No | Content: OK | " +
        "Response time: 842 ms | HTTP status: 200"
    );
    expect(line).toContain(green("OK"));
    expect(line).toContain(green("No"));
  });

  it("describes a failed attempt with a challenge and an error", () => {
    const text = formatAttemptResult(
      createAttemptResult({
        status: 403,
        requestSuccess: false,
        contentSuccess: false,
        challenge: true,
        error: "boom",
      })
    );

    const [line, errorLine] = text.split("\n");

    expect(stripVTControlCharacters(line ?? "")).toBe(
      `Attempt 1/${String(CONFIG.attempts)} Request: FAIL | Challenge: YES | ` +
        "Content: FAIL | Response time: 100 ms | HTTP status: 403"
    );
    expect(line).toContain(red("FAIL"));
    expect(line).toContain(red("YES"));
    expect(line).toContain(red("403"));
    expect(errorLine).toBe(`Error: ${red("boom")}`);
  });

  it("reports a challenge that resolved by itself as AUTO in yellow", () => {
    const line = formatAttemptResult(
      createAttemptResult({ challenge: true, contentSuccess: true })
    );

    expect(stripVTControlCharacters(line)).toContain("Challenge: AUTO |");
    expect(line).toContain(yellow("AUTO"));
    expect(line).not.toContain(red("YES"));
  });

  it("reports a challenge that a person solved as MANUAL, not as AUTO", () => {
    const line = formatAttemptResult(
      createAttemptResult({
        challenge: true,
        contentSuccess: true,
        manualChallenge: true,
      })
    );

    expect(stripVTControlCharacters(line)).toContain("Challenge: MANUAL |");
    expect(line).toContain(cyan("MANUAL"));
    expect(line).not.toContain("AUTO");
    expect(line).not.toContain(red("YES"));
  });

  it("reports a challenge that stayed unresolved as YES even if a person tried", () => {
    const line = formatAttemptResult(
      createAttemptResult({
        challenge: true,
        contentSuccess: false,
        manualChallenge: true,
      })
    );

    expect(stripVTControlCharacters(line)).toContain("Challenge: YES |");
    expect(line).not.toContain("MANUAL");
  });

  it("shows a challenge status that the target accepted in yellow", () => {
    const line = formatAttemptResult(
      createAttemptResult({
        status: 498,
        requestSuccess: true,
        challenge: true,
        contentSuccess: true,
      })
    );

    expect(line).toContain(yellow("498"));
    expect(line).toContain(green("OK"));
  });

  it("keeps a failed status red when the request was not accepted", () => {
    const line = formatAttemptResult(
      createAttemptResult({ status: 498, requestSuccess: false })
    );

    expect(line).toContain(red("498"));
  });

  it("renders a missing HTTP status as a dash", () => {
    const text = formatAttemptResult(
      createAttemptResult({ status: null, requestSuccess: false })
    );

    expect(stripVTControlCharacters(text)).toContain("HTTP status: -");
  });
});

describe("formatSummary", () => {
  it("renders request/content/challenge statistics and response times", () => {
    const summary = formatSummary([
      createTargetResult({
        target: createTarget({ name: "Example" }),
        results: [
          createAttemptResult({ responseTime: 100 }),
          createAttemptResult({
            attempt: 2,
            requestSuccess: false,
            contentSuccess: false,
            challenge: true,
            responseTime: 300,
          }),
        ],
      }),
    ]);

    expect(stripVTControlCharacters(summary)).toBe(
      [
        "",
        "Statistics after 10 attempts",
        "",
        "┌─────────┬──────────┬─────────┬─────────┬─────────┬───────────┬───────────┐",
        "│ Target  │ Requests │ Request │ Content │ Content │ Challenge │ Challenge │",
        "├─────────┼──────────┼─────────┼─────────┼─────────┼───────────┼───────────┤",
        "│ Example │ 1/2      │ 50%     │ 1/2     │ 50%     │ 1/2       │ 50%       │",
        "└─────────┴──────────┴─────────┴─────────┴─────────┴───────────┴───────────┘",
        "",
        "Response time",
        "┌─────────┬────────┬────────┬────────┬────────┬────────┐",
        "│ Target  │ AVG    │ P50    │ P90    │ P95    │ P99    │",
        "├─────────┼────────┼────────┼────────┼────────┼────────┤",
        "│ Example │ 200 ms │ 200 ms │ 280 ms │ 290 ms │ 298 ms │",
        "└─────────┴────────┴────────┴────────┴────────┴────────┘",
      ].join("\n")
    );
  });
});

describe("formatRunHeader", () => {
  it("describes a direct run", () => {
    expect(formatRunHeader(createCliOptions())).toBe(
      [
        "",
        "Mode: DIRECT",
        "Attempts: 10",
        "Context mode: NEW PER ATTEMPT",
        "Browser: chromium",
        "Targets: global",
        "",
      ].join("\n")
    );
  });

  it("masks the proxy password and shows the reused context mode", () => {
    const header = formatRunHeader(
      createCliOptions({
        proxyUrl: "socks5://login:secret@1.2.3.4:1080",
        reuseContext: true,
      })
    );

    expect(header).toContain("Mode: socks5://login:***@1.2.3.4:1080");
    expect(header).toContain("Context mode: REUSED");
    expect(header).not.toContain("secret");
  });
});

describe("createOutput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T19:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the result document for a direct run", () => {
    const targetResult = createTargetResult({
      target: createTarget({ name: "Example", url: "https://example.com/" }),
      results: [createAttemptResult({ responseTime: 200 })],
    });

    const output = createOutput("1.2.3.4", [targetResult], createCliOptions());

    expect(output).toEqual({
      mode: "DIRECT",
      proxy: null,
      externalIP: "1.2.3.4",
      attempts: CONFIG.attempts,
      contextMode: "NEW_PER_ATTEMPT",
      browser: "chromium",
      targetSet: "global",
      generatedAt: "2026-09-28T19:00:00.000Z",
      targets: [
        {
          name: "Example",
          url: "https://example.com/",
          results: targetResult.results,
          stats: {
            avg: 200,
            p50: 200,
            p90: 200,
            p95: 200,
            p99: 200,
          },
        },
      ],
    });
  });

  it("keeps the original fields in their original order", () => {
    const output = createOutput("1.2.3.4", [], createCliOptions());

    const keys = Object.keys(output);
    const originalKeys = [
      "mode",
      "proxy",
      "externalIP",
      "attempts",
      "contextMode",
      "generatedAt",
      "targets",
    ];

    expect(keys.filter((key) => originalKeys.includes(key))).toEqual(
      originalKeys
    );
  });

  it("never stores the proxy password in plain text", () => {
    const output = createOutput(
      "1.2.3.4",
      [],
      createCliOptions({
        proxyUrl: "socks5://login:secret@1.2.3.4:1080",
        reuseContext: true,
      })
    );

    expect(output.mode).toBe("SOCKS5");
    expect(output.contextMode).toBe("REUSED");
    expect(output.proxy).toBe("socks5://login:***@1.2.3.4:1080");
    expect(JSON.stringify(output)).not.toContain("secret");
  });
});
