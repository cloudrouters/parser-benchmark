import type { CliOptions } from "../cli/args.js";
import { isSuccessfulStatus } from "../checks/page-checks.js";
import { maskProxyUrl } from "../proxy/proxy-url.js";
import { calculateStats } from "../results/stats.js";
import type {
  AttemptResult,
  ResponseStats,
  TargetResult,
} from "../results/types.js";
import { boldWhite, cyan, green, red, yellow } from "../shared/ansi.js";
import { CONFIG } from "../shared/config.js";

export interface BenchmarkOutput {
  mode: "DIRECT" | "SOCKS5";
  proxy: string | null;
  externalIP: string;
  attempts: number;
  contextMode: "REUSED" | "NEW_PER_ATTEMPT";
  browser: string;
  targetSet: string;
  generatedAt: string;
  targets: {
    name: string;
    url: string;
    results: AttemptResult[];
    stats: ResponseStats;
  }[];
}

export function formatPercent(value: number): string {
  return `${String(Math.round(value))}%`;
}

export function formatMs(value: number | null): string {
  return value === null ? "-" : `${String(Math.round(value))} ms`;
}

export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): string {
  const widths = headers.map((header, index) => {
    const maxRowWidth = rows.reduce(
      (max, row) => Math.max(max, (row[index] ?? "").length),
      0
    );

    return Math.max(header.length, maxRowWidth);
  });

  const border = (left: string, junction: string, right: string): string =>
    `${left}${widths
      .map((width) => "─".repeat(width + 2))
      .join(junction)}${right}`;

  const formatRow = (row: readonly string[]): string =>
    `│ ${row
      .map((value, index) => value.padEnd(widths[index] ?? 0))
      .join(" │ ")} │`;

  return [
    border("┌", "┬", "┐"),
    formatRow(headers),
    border("├", "┼", "┤"),
    ...rows.map(formatRow),
    border("└", "┴", "┘"),
  ].join("\n");
}

/**
 * A challenge that was passed is reported as AUTO (by itself) or MANUAL (with
 * the help of a person) so that it is not mistaken for a challenge that
 * blocked the attempt.
 */
function formatChallenge(result: AttemptResult): string {
  if (!result.challenge) {
    return green("No");
  }

  if (!result.contentSuccess) {
    return red("YES");
  }

  return result.manualChallenge ? cyan("MANUAL") : yellow("AUTO");
}

function formatStatus(result: AttemptResult): string {
  const statusText = result.status === null ? "-" : String(result.status);

  if (isSuccessfulStatus(result.status)) {
    return green(statusText);
  }

  /*
   * A request that was accepted despite a non-successful status carries a
   * challenge status of the target, not a failure.
   */
  return result.requestSuccess ? yellow(statusText) : red(statusText);
}

export function formatAttemptResult(result: AttemptResult): string {
  const requestValue = result.requestSuccess ? green("OK") : red("FAIL");

  const challengeValue = formatChallenge(result);

  const contentValue = result.contentSuccess ? green("OK") : red("FAIL");

  const statusValue = formatStatus(result);

  const line =
    `Attempt ${String(result.attempt)}/${String(CONFIG.attempts)} ` +
    `Request: ${requestValue} | ` +
    `Challenge: ${challengeValue} | ` +
    `Content: ${contentValue} | ` +
    `Response time: ${String(result.responseTime)} ms | ` +
    `HTTP status: ${statusValue}`;

  if (result.error === null) {
    return line;
  }

  return `${line}\nError: ${red(result.error)}`;
}

export function formatSummary(allResults: readonly TargetResult[]): string {
  const rows = allResults.map(({ target, results }) => {
    const requests = results.filter((result) => result.requestSuccess).length;
    const contents = results.filter((result) => result.contentSuccess).length;
    const challenges = results.filter((result) => result.challenge).length;
    const total = results.length;

    return [
      target.name,
      `${String(requests)}/${String(total)}`,
      formatPercent((requests / total) * 100),
      `${String(contents)}/${String(total)}`,
      formatPercent((contents / total) * 100),
      `${String(challenges)}/${String(total)}`,
      formatPercent((challenges / total) * 100),
    ];
  });

  const responseRows = allResults.map(({ target, results }) => {
    const stats = calculateStats(results);

    return [
      target.name,
      formatMs(stats.avg),
      formatMs(stats.p50),
      formatMs(stats.p90),
      formatMs(stats.p95),
      formatMs(stats.p99),
    ];
  });

  return [
    "",
    boldWhite(`Statistics after ${String(CONFIG.attempts)} attempts`),
    "",
    renderTable(
      [
        "Target",
        "Requests",
        "Request",
        "Content",
        "Content",
        "Challenge",
        "Challenge",
      ],
      rows
    ),
    "",
    boldWhite("Response time"),
    renderTable(["Target", "AVG", "P50", "P90", "P95", "P99"], responseRows),
  ].join("\n");
}

export function formatRunHeader(options: CliOptions): string {
  const { proxyUrl, reuseContext, browser, targetSet } = options;

  return [
    "",
    `Mode: ${proxyUrl === null ? "DIRECT" : maskProxyUrl(proxyUrl)}`,
    `Attempts: ${String(CONFIG.attempts)}`,
    `Context mode: ${reuseContext ? "REUSED" : "NEW PER ATTEMPT"}`,
    `Browser: ${browser.name}`,
    `Targets: ${targetSet.name}`,
    "",
  ].join("\n");
}

export function createOutput(
  externalIP: string,
  allResults: readonly TargetResult[],
  options: CliOptions
): BenchmarkOutput {
  const { proxyUrl, reuseContext, browser, targetSet } = options;

  return {
    mode: proxyUrl === null ? "DIRECT" : "SOCKS5",
    proxy: proxyUrl === null ? null : maskProxyUrl(proxyUrl),
    externalIP,
    attempts: CONFIG.attempts,
    contextMode: reuseContext ? "REUSED" : "NEW_PER_ATTEMPT",
    browser: browser.name,
    targetSet: targetSet.name,
    generatedAt: new Date().toISOString(),
    targets: allResults.map((item) => ({
      name: item.target.name,
      url: item.target.url,
      results: item.results,
      stats: calculateStats(item.results),
    })),
  };
}
