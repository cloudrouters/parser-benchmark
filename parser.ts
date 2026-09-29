import { writeFile } from "node:fs/promises";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import * as ProxyChain from "proxy-chain";

const CONFIG = {
  attempts: 10,
  headless: false,
  ipCheckUrl: "https://api.ipify.org/?format=json",
  internetCheckTimeoutMs: 15_000,
  pageTimeoutMs: 30_000,
  navigationRecoveryTimeoutMs: 5_000,
  contentWaitTimeoutMs: 5_000,
  challengeWaitTimeoutMs: 30_000,
  contentCheckIntervalMs: 250,
  attemptDelayMs: 1_000,
  outputFile: "benchmark-results.json",
} as const;

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  white: "\x1b[97m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[96m",
} as const;

const TARGETS = [
  {
    name: "Google",

    url: "https://www.google.com/",

    content: ["Google"],
  },

  {
    name: "Bing",

    url: "https://www.bing.com/",

    content: ["Bing"],
  },

  {
    name: "Amazon",

    url: "https://www.amazon.com/",

    content: ["Amazon"],
  },

  {
    name: "eBay",

    url: "https://www.ebay.com/",

    content: ["eBay"],
  },

  {
    name: "Walmart",

    url: "https://www.walmart.com/",

    content: ["Walmart"],
  },

  {
    name: "Booking",

    url: "https://www.booking.com/",

    content: ["Booking.com"],
  },

  {
    name: "LinkedIn",

    url: "https://www.linkedin.com/",

    content: ["LinkedIn"],
  },
] as const;

const CHALLENGE_PATTERNS = [
  "just a moment",
  "checking your browser",
  "verify you are human",
  "verify you are a human",
  "unusual traffic",
  "access denied",
  "security check",
  "captcha",
  "recaptcha",
  "hcaptcha",
  "cf-chl-",
  "cloudflare",
  "akamai",
  "bot manager",
  "are you a robot",
] as const;

type Target = (typeof TARGETS)[number];

type AttemptResult = {
  attempt: number;
  status: number | null;
  requestSuccess: boolean;
  contentSuccess: boolean;
  challenge: boolean;
  responseTime: number;
  finalUrl: string | null;
  title: string | null;
  error: string | null;
};

type TargetResult = {
  target: Target;
  results: AttemptResult[];
};

type ResponseStats = {
  avg: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
};

type LocalProxy = {
  url: string;
  port: string;
};

type ContextOptions = {
  locale: string;
  timezoneId: string;
  viewport: {
    width: number;

    height: number;
  };
  proxy?: {
    server: string;
  };
};

type IpifyResponse = {
  ip: string;
};

type ContentCheckResult = {
  success: boolean;

  challenge: boolean;
};

const args = process.argv.slice(2);

const reuseContext = args.includes("--reuse-context");

const proxyUrl = args.find((arg) => !arg.startsWith("--")) ?? null;

function color(text: string, ansiColor: string): string {
  return `${ansiColor}${text}${ANSI.reset}`;
}

function boldWhite(text: string): string {
  return color(`${ANSI.bold}${text}`, ANSI.white);
}

function green(text: string): string {
  return color(text, ANSI.green);
}

function red(text: string): string {
  return color(text, ANSI.red);
}

function cyan(text: string): string {
  return color(text, ANSI.cyan);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isSuccessfulStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 400;
}

function maskProxyUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.username !== "") {
      url.password = "***";
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/^(socks5:\/\/[^:]+:)[^@]+(@.*)$/i, "$1***$2");
  }
}

function validateProxyUrl(value: string | null): void {
  if (value === null) {
    return;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'Invalid proxy URL. Expected: "socks5://user:password@host:port"'
    );
  }

  if (url.protocol !== "socks5:") {
    throw new Error('Invalid proxy URL. Expected protocol: "socks5://"');
  }

  if (url.hostname === "" || url.port === "") {
    throw new Error(
      'Invalid proxy URL. Expected: "socks5://user:password@host:port"'
    );
  }
}

function getContextOptions(localPort: string | null): ContextOptions {
  const options: ContextOptions = {
    locale: "en-US",

    timezoneId: "America/New_York",

    viewport: {
      width: 1366,

      height: 768,
    },
  };

  if (localPort === null) {
    return options;
  }

  return {
    ...options,

    proxy: {
      server: `http://127.0.0.1:${localPort}`,
    },
  };
}

async function startProxyBridge(
  socks5Url: string | null
): Promise<LocalProxy | null> {
  if (socks5Url === null) {
    return null;
  }

  console.log("Starting local proxy bridge...");

  const anonymizedUrl = await ProxyChain.anonymizeProxy({
    url: socks5Url,
  });

  const parsedUrl = new URL(anonymizedUrl);

  console.log(`Local HTTP proxy: ${parsedUrl.hostname}:${parsedUrl.port}`);

  return {
    url: anonymizedUrl,

    port: parsedUrl.port,
  };
}

async function stopProxyBridge(bridge: LocalProxy | null): Promise<void> {
  if (bridge === null) {
    return;
  }

  try {
    await ProxyChain.closeAnonymizedProxy(bridge.url, true);
  } catch {
    // Cleanup errors must not mask the original benchmark result.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIpifyResponse(value: unknown): IpifyResponse {
  if (
    !isRecord(value) ||
    typeof value.ip !== "string" ||
    value.ip.trim() === ""
  ) {
    throw new Error("IP address was not found in response.");
  }

  return {
    ip: value.ip.trim(),
  };
}

async function getPageText(page: Page): Promise<string> {
  try {
    const [title, body] = await Promise.all([
      page.title().catch(() => ""),

      page
        .locator("body")
        .innerText({
          timeout: CONFIG.contentWaitTimeoutMs,
        })
        .catch(() => ""),
    ]);

    return `${title}\n${body}`.toLowerCase();
  } catch {
    return "";
  }
}

function containsChallenge(text: string): boolean {
  return CHALLENGE_PATTERNS.some((pattern) => text.includes(pattern));
}

function containsExpectedContent(
  text: string,
  expectedContent: readonly string[]
): boolean {
  return expectedContent.some((content) =>
    text.includes(content.toLowerCase())
  );
}

function isRealHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function waitForRealNavigation(page: Page): Promise<boolean> {
  const deadline = Date.now() + CONFIG.navigationRecoveryTimeoutMs;

  while (Date.now() < deadline) {
    let currentUrl = "";

    try {
      currentUrl = page.url();
    } catch {
      return false;
    }

    if (isRealHttpUrl(currentUrl)) {
      return true;
    }

    await sleep(CONFIG.contentCheckIntervalMs);
  }

  let finalUrl = "";

  try {
    finalUrl = page.url();
  } catch {
    finalUrl = "unavailable";
  }

  if (isRealHttpUrl(finalUrl)) {
    return true;
  }

  return false;
}

async function waitForExpectedContent(
  page: Page,
  expectedContent: readonly string[]
): Promise<ContentCheckResult> {
  const normalDeadline = Date.now() + CONFIG.contentWaitTimeoutMs;

  let deadline = normalDeadline;

  let challengeDetected = false;

  let challengeLogged = false;

  while (Date.now() < deadline) {
    const text = await getPageText(page);

    const currentChallenge = containsChallenge(text);

    const currentContent = containsExpectedContent(text, expectedContent);

    /*
     * If a challenge is present, expected content
     * does NOT count as success.
     *
     * eBay's challenge page itself contains the
     * word "eBay", so checking content first would
     * incorrectly finish the attempt immediately.
     */
    if (currentChallenge) {
      if (!challengeDetected) {
        challengeDetected = true;

        deadline = Date.now() + CONFIG.challengeWaitTimeoutMs;
      }

      if (!challengeLogged) {
        console.log(
          `Challenge detected. Waiting up to ${
            CONFIG.challengeWaitTimeoutMs / 1000
          } seconds for automatic resolution...`
        );

        challengeLogged = true;
      }

      await sleep(CONFIG.contentCheckIntervalMs);

      continue;
    }

    /*
     * Challenge disappeared.
     *
     * Only now can expected content be considered
     * a successful result.
     */
    if (currentContent) {
      return {
        success: true,

        challenge: challengeDetected,
      };
    }

    await sleep(CONFIG.contentCheckIntervalMs);
  }

  /*
   * Final check after timeout.
   */
  const finalText = await getPageText(page);

  const finalChallenge = containsChallenge(finalText);

  const finalContent = containsExpectedContent(finalText, expectedContent);

  /*
   * If challenge is still present, it is a
   * genuine unresolved challenge.
   */
  if (finalChallenge) {
    return {
      success: false,

      challenge: true,
    };
  }

  return {
    success: finalContent,

    challenge: challengeDetected,
  };
}

async function checkInternet(
  browser: Browser,
  localPort: string | null
): Promise<string | null> {
  const context = await browser.newContext(getContextOptions(localPort));

  try {
    const page = await context.newPage();

    const response = await page.goto(CONFIG.ipCheckUrl, {
      waitUntil: "domcontentloaded",

      timeout: CONFIG.internetCheckTimeoutMs,
    });

    if (response === null) {
      throw new Error("IP check returned no response.");
    }

    const status = response.status();

    if (!isSuccessfulStatus(status)) {
      throw new Error(`IP check returned HTTP ${status}.`);
    }

    const body = await page.locator("body").innerText({
      timeout: CONFIG.internetCheckTimeoutMs,
    });

    let parsed: unknown;

    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("IP check returned invalid JSON.");
    }

    const data = parseIpifyResponse(parsed);

    console.log(`External IP: ${cyan(data.ip)}`);

    console.log(`Internet connection: ${green("OK")}`);

    return data.ip;
  } catch (error) {
    console.error("");

    console.error("Internet connection check failed.");

    console.error(`Reason: ${getErrorMessage(error)}`);

    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

async function saveChallengeDiagnostics(
  page: Page,
  target: Target,
  attempt: number
): Promise<void> {
  if (target.name !== "eBay") {
    return;
  }

  console.log("");

  console.log(`Challenge diagnostics for attempt ${attempt}:`);

  try {
    console.log(`Final URL: ${page.url()}`);
  } catch {
    console.log("Final URL: unavailable");
  }

  try {
    console.log(`Title: ${await page.title()}`);
  } catch {
    console.log("Title: unavailable");
  }

  try {
    const bodyText = await page.locator("body").innerText({
      timeout: CONFIG.contentWaitTimeoutMs,
    });

    console.log(
      `Body preview: ${bodyText.replace(/\s+/g, " ").trim().slice(0, 1000)}`
    );
  } catch {
    console.log("Body preview: unavailable");
  }

  try {
    const screenshotPath = `ebay-challenge-${attempt}.png`;

    await page.screenshot({
      path: screenshotPath,

      fullPage: true,
    });

    console.log(`Screenshot saved to ${screenshotPath}`);
  } catch (error) {
    console.log(`Screenshot failed: ${getErrorMessage(error)}`);
  }

  console.log("");
}

async function runAttempt(
  browser: Browser,
  target: Target,
  attempt: number,
  localPort: string | null,
  context?: BrowserContext
): Promise<AttemptResult> {
  const ownContext =
    context === undefined
      ? await browser.newContext(getContextOptions(localPort))
      : null;

  const activeContext = context ?? ownContext!;

  const page = await activeContext.newPage();

  const startedAt = Date.now();

  let status: number | null = null;

  let navigationError: string | null = null;

  let navigationStuck = false;

  let response: Awaited<ReturnType<Page["goto"]>> = null;

  try {
    try {
      response = await page.goto(target.url, {
        waitUntil: "domcontentloaded",

        timeout: CONFIG.pageTimeoutMs,
      });

      if (response !== null) {
        status = response.status();
      }

      /*
       * Playwright can return a successful HTTP response
       * while the browser itself is still sitting on
       * about:blank / another about:* URL.
       *
       * In this case we wait up to 5 seconds for the
       * actual HTTP/HTTPS navigation to appear.
       */
      if (isSuccessfulStatus(status)) {
        const navigated = await waitForRealNavigation(page);

        if (!navigated) {
          navigationStuck = true;

          navigationError =
            `Page remained on "${page.url()}" ` +
            `for ${CONFIG.navigationRecoveryTimeoutMs / 1000} seconds.`;

          console.log(
            `Navigation did not complete within ${
              CONFIG.navigationRecoveryTimeoutMs / 1000
            } seconds. Retrying...`
          );
        }
      }
    } catch (error) {
      navigationError = getErrorMessage(error);
    }

    let requestSuccess = false;

    let contentSuccess = false;

    let challenge = false;

    if (!navigationStuck && isSuccessfulStatus(status)) {
      requestSuccess = true;

      const contentResult = await waitForExpectedContent(page, target.content);

      contentSuccess = contentResult.success;

      challenge = contentResult.challenge;
    } else if (!navigationStuck) {
      const text = await getPageText(page);

      challenge = containsChallenge(text);
    }

    const responseTime = Date.now() - startedAt;

    let finalUrl: string | null = null;

    let title: string | null = null;

    try {
      finalUrl = page.url();

      title = await page.title();
    } catch {
      // Page metadata is optional diagnostic information.
    }

    /*
     * Diagnostics are saved only when the challenge
     * remains unresolved and content is unavailable.
     */
    if (challenge && !contentSuccess) {
      await saveChallengeDiagnostics(page, target, attempt);
    }

    return {
      attempt,

      status: navigationStuck ? null : status,

      requestSuccess,

      contentSuccess,

      challenge,

      responseTime,

      finalUrl,

      title,

      error: navigationError,
    };
  } finally {
    /*
     * Only the current Page is closed.
     *
     * The Browser and, when --reuse-context is used,
     * the BrowserContext remain alive.
     */
    await page.close().catch(() => {});

    if (ownContext !== null) {
      await ownContext.close().catch(() => {});
    }
  }
}

function percentile(
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

  if (lower === upper) {
    return sorted[lower]!;
  }

  const lowerValue = sorted[lower]!;

  const upperValue = sorted[upper]!;

  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

function calculateStats(results: readonly AttemptResult[]): ResponseStats {
  const responseTimes = results
    .map((result) => result.responseTime)
    .filter(Number.isFinite);

  if (responseTimes.length === 0) {
    return {
      avg: null,

      p50: null,

      p90: null,

      p95: null,

      p99: null,
    };
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

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatMs(value: number | null): string {
  return value === null ? "-" : `${Math.round(value)} ms`;
}

function printTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): void {
  const widths = headers.map((header, index) => {
    const maxRowWidth = rows.reduce(
      (max, row) => Math.max(max, String(row[index] ?? "").length),
      0
    );

    return Math.max(header.length, maxRowWidth);
  });

  const top = `┌${widths.map((width) => "─".repeat(width + 2)).join("┬")}┐`;

  const middle = `├${widths.map((width) => "─".repeat(width + 2)).join("┼")}┤`;

  const bottom = `└${widths.map((width) => "─".repeat(width + 2)).join("┴")}┘`;

  const formatRow = (row: readonly string[]): string =>
    `│ ${row
      .map((value, index) => String(value ?? "").padEnd(widths[index]!))
      .join(" │ ")} │`;

  console.log(top);

  console.log(formatRow(headers));

  console.log(middle);

  for (const row of rows) {
    console.log(formatRow(row));
  }

  console.log(bottom);
}

function printAttemptResult(result: AttemptResult): void {
  const requestValue = result.requestSuccess ? green("OK") : red("FAIL");

  const challengeValue = result.challenge ? red("YES") : green("No");

  const contentValue = result.contentSuccess ? green("OK") : red("FAIL");

  const statusText = result.status === null ? "-" : String(result.status);

  const statusValue = isSuccessfulStatus(result.status)
    ? green(statusText)
    : red(statusText);

  console.log(
    `Attempt ${result.attempt}/${CONFIG.attempts} ` +
      `Request: ${requestValue} | ` +
      `Challenge: ${challengeValue} | ` +
      `Content: ${contentValue} | ` +
      `Response time: ${result.responseTime} ms | ` +
      `HTTP status: ${statusValue}`
  );

  if (result.error !== null) {
    console.log(`Error: ${red(result.error)}`);
  }
}

async function runTarget(
  browser: Browser,
  target: Target,
  localPort: string | null
): Promise<AttemptResult[]> {
  console.log("");

  console.log(boldWhite(target.name));

  const results: AttemptResult[] = [];

  let sharedContext: BrowserContext | null = null;

  try {
    if (reuseContext) {
      sharedContext = await browser.newContext(getContextOptions(localPort));
    }

    for (let attempt = 1; attempt <= CONFIG.attempts; attempt++) {
      const result = await runAttempt(
        browser,

        target,

        attempt,

        localPort,

        sharedContext ?? undefined
      );

      results.push(result);

      printAttemptResult(result);

      /*
       * If every attempt has failed because the page
       * remained on about:* instead of navigating to
       * the target, stop the benchmark with an error.
       */
      if (
        attempt === CONFIG.attempts &&
        results.every(
          (item) =>
            item.error !== null && item.error.includes("Page remained on")
        )
      ) {
        throw new Error(
          `${target.name} navigation failed ` +
            `${CONFIG.attempts} consecutive times. ` +
            `The browser remained on about:* instead of navigating to the target.`
        );
      }

      if (attempt < CONFIG.attempts) {
        await sleep(CONFIG.attemptDelayMs);
      }
    }

    return results;
  } finally {
    if (sharedContext !== null) {
      await sharedContext.close().catch(() => {});
    }
  }
}

function printSummary(allResults: readonly TargetResult[]): void {
  console.log("");

  console.log(boldWhite(`Statistics after ${CONFIG.attempts} attempts`));

  console.log("");

  const rows = allResults.map((item) => {
    const { results } = item;

    const requests = results.filter((result) => result.requestSuccess).length;

    const contents = results.filter((result) => result.contentSuccess).length;

    const challenges = results.filter((result) => result.challenge).length;

    const total = results.length;

    return [
      item.target.name,

      `${requests}/${total}`,

      formatPercent((requests / total) * 100),

      `${contents}/${total}`,

      formatPercent((contents / total) * 100),

      `${challenges}/${total}`,

      formatPercent((challenges / total) * 100),
    ];
  });

  printTable(
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
  );

  console.log("");

  console.log(boldWhite("Response time"));

  const responseRows = allResults.map((item) => {
    const stats = calculateStats(item.results);

    return [
      item.target.name,

      formatMs(stats.avg),

      formatMs(stats.p50),

      formatMs(stats.p90),

      formatMs(stats.p95),

      formatMs(stats.p99),
    ];
  });

  printTable(
    ["Target", "AVG", "P50", "P90", "P95", "P99"],

    responseRows
  );
}

function createOutput(externalIP: string, allResults: readonly TargetResult[]) {
  return {
    mode: proxyUrl === null ? "DIRECT" : "SOCKS5",

    proxy: proxyUrl === null ? null : maskProxyUrl(proxyUrl),

    externalIP,

    attempts: CONFIG.attempts,

    contextMode: reuseContext ? "REUSED" : "NEW_PER_ATTEMPT",

    generatedAt: new Date().toISOString(),

    targets: allResults.map((item) => ({
      name: item.target.name,

      url: item.target.url,

      results: item.results,

      stats: calculateStats(item.results),
    })),
  };
}

async function main(): Promise<void> {
  validateProxyUrl(proxyUrl);

  console.log("");

  console.log(`Mode: ${proxyUrl === null ? "DIRECT" : maskProxyUrl(proxyUrl)}`);

  console.log(`Attempts: ${CONFIG.attempts}`);

  console.log(`Context mode: ${reuseContext ? "REUSED" : "NEW PER ATTEMPT"}`);

  console.log("");

  let browser: Browser | null = null;

  let proxyBridge: LocalProxy | null = null;

  try {
    if (proxyUrl !== null) {
      proxyBridge = await startProxyBridge(proxyUrl);
    }

    browser = await chromium.launch({
      headless: CONFIG.headless,
    });

    if (proxyUrl !== null) {
      console.log("Checking connection through SOCKS5...");
    } else {
      console.log("Checking internet connection...");
    }

    const externalIP = await checkInternet(
      browser,

      proxyBridge?.port ?? null
    );

    if (externalIP === null) {
      console.log("");

      console.log("Benchmark stopped.");

      return;
    }

    const allResults: TargetResult[] = [];

    for (const target of TARGETS) {
      const results = await runTarget(
        browser,

        target,

        proxyBridge?.port ?? null
      );

      allResults.push({
        target,

        results,
      });
    }

    printSummary(allResults);

    const output = createOutput(
      externalIP,

      allResults
    );

    await writeFile(
      CONFIG.outputFile,

      JSON.stringify(output, null, 2),

      "utf8"
    );

    console.log("");

    console.log(`Results saved to ${CONFIG.outputFile}`);
  } catch (error) {
    console.error("");

    console.error("Benchmark failed:");

    console.error(getErrorMessage(error));

    process.exitCode = 1;
  } finally {
    if (browser !== null) {
      await browser.close().catch(() => {});
    }

    await stopProxyBridge(proxyBridge);
  }
}

void main();
