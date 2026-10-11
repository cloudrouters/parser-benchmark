import { writeFile } from "node:fs/promises";


import {
 navigateChrome,
 navigateChromeToBlank,
 readPageSnapshot,
 startChrome,
 stopChrome,
 waitForNavigation,
} from "./chrome";


import { checkRuServicePage, RU_SERVICES, type RuService } from "./services";


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
 target: RuService;
 results: AttemptResult[];
};


type LocalProxy = {
 url: string;
 port: string;
};


type RussianModeOptions = {
 proxyUrl: string | null;
 attempts: number;
 attemptDelayMs: number;
 challengeWaitTimeoutMs: number;
 contentCheckIntervalMs: number;
 outputFile: string;
 validateProxyUrl: (url: string | null) => void;
 startProxyBridge: (url: string | null) => Promise<LocalProxy | null>;
 stopProxyBridge: (bridge: LocalProxy | null) => Promise<void>;
 maskProxyUrl: (url: string) => string;
 isSuccessfulStatus: (status: number | null) => boolean;
 reuseContext: boolean;
};


const ANSI = {
 reset: "\x1b[0m",
 bold: "\x1b[1m",
 white: "\x1b[97m",
 green: "\x1b[32m",
 red: "\x1b[31m",
 cyan: "\x1b[96m",
} as const;


function color(text: string, ansi: string): string {
 return `${ansi}${text}${ANSI.reset}`;
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
 return new Promise((resolve) => setTimeout(resolve, milliseconds));
}


function getErrorMessage(error: unknown): string {
 return error instanceof Error ? error.message : String(error);
}


function formatPercent(value: number): string {
 return `${Math.round(value)}%`;
}


function formatMs(value: number | null): string {
 return value === null ? "-" : `${Math.round(value)} ms`;
}


function percentile(
 values: readonly number[],
 percentileValue: number
): number | null {
 if (values.length === 0) return null;


 const sorted = [...values].sort((a, b) => a - b);
 const index = (percentileValue / 100) * (sorted.length - 1);
 const lower = Math.floor(index);
 const upper = Math.ceil(index);


 if (lower === upper) return sorted[lower]!;


 return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}


function calculateStats(results: readonly AttemptResult[]) {
 const values = results
   .map((result) => result.responseTime)
   .filter(Number.isFinite);


 if (values.length === 0) {
   return {
     avg: null,
     p50: null,
     p90: null,
     p95: null,
     p99: null,
   };
 }


 return {
   avg: values.reduce((sum, value) => sum + value, 0) / values.length,
   p50: percentile(values, 50),
   p90: percentile(values, 90),
   p95: percentile(values, 95),
   p99: percentile(values, 99),
 };
}


function printTable(
 headers: readonly string[],
 rows: readonly (readonly string[])[]
): void {
 const widths = headers.map((header, index) =>
   Math.max(
     header.length,
     ...rows.map((row) => String(row[index] ?? "").length)
   )
 );


 const top = `┌${widths.map((width) => "─".repeat(width + 2)).join("┬")}┐`;
 const middle = `├${widths.map((width) => "─".repeat(width + 2)).join("┼")}┤`;
 const bottom = `└${widths.map((width) => "─".repeat(width + 2)).join("┴")}┘`;


 const formatRow = (row: readonly string[]) =>
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


function parseExternalIp(body: string): string {
 let parsed: unknown;


 try {
   parsed = JSON.parse(body);
 } catch {
   throw new Error("IP check returned invalid JSON.");
 }


 if (
   typeof parsed !== "object" ||
   parsed === null ||
   !("ip" in parsed) ||
   typeof parsed.ip !== "string" ||
   parsed.ip.trim() === ""
 ) {
   throw new Error("IP address was not found in response.");
 }


 return parsed.ip.trim();
}


async function checkChromeInternet(): Promise<string> {
 const ipCheckUrl = "https://api.ipify.org/?format=json";


 await navigateChromeToBlank();
 await navigateChrome(ipCheckUrl);


 const snapshot = await waitForNavigation(ipCheckUrl, 15_000);


 if (
   snapshot.status === null ||
   snapshot.status < 200 ||
   snapshot.status >= 400
 ) {
   throw new Error(
     `Chrome IP check failed with HTTP status ${snapshot.status ?? "unknown"}.`
   );
 }


 const ip = parseExternalIp(snapshot.body);


 console.log(`External IP: ${cyan(ip)}`);
 console.log(`Internet connection: ${green("OK")}`);


 return ip;
}


async function runServiceAttempt(
 service: RuService,
 attempt: number,
 options: RussianModeOptions
): Promise<AttemptResult> {
 const startedAt = Date.now();


 let status: number | null = null;
 let challenge = false;
 let contentSuccess = false;
 let finalUrl: string | null = null;
 let title: string | null = null;
 let error: string | null = null;


 try {
   await navigateChromeToBlank();
   await navigateChrome(service.url);


   let snapshot = await waitForNavigation(service.url, 30_000);


   const deadline = Date.now() + options.challengeWaitTimeoutMs;


   while (true) {
     finalUrl = snapshot.url;
     title = snapshot.title;


     const check = checkRuServicePage(service, snapshot);


     if (snapshot.status !== null) {
       status = snapshot.status;
     }


     if (check.contentSuccess) {
       contentSuccess = true;
       challenge = false;
       error = null;
       break;
     }


     if (check.challenge) {
       challenge = true;
     }


     if (Date.now() >= deadline) {
       error = challenge
         ? "Challenge or suspicious activity detected; content did not pass validation."
         : "Content validation did not pass before timeout.";
       break;
     }


     await sleep(options.contentCheckIntervalMs);
     snapshot = await readPageSnapshot();
   }
 } catch (caught) {
   error = getErrorMessage(caught);


   try {
     const snapshot = await readPageSnapshot();
     const check = checkRuServicePage(service, snapshot);


     finalUrl = snapshot.url;
     title = snapshot.title;
     status = snapshot.status;
     challenge = check.challenge;
     contentSuccess = check.contentSuccess;


     if (contentSuccess) {
       challenge = false;
       error = null;
     }
   } catch {
     // Preserve the original error.
   }
 }


 return {
   attempt,
   status,
   requestSuccess: options.isSuccessfulStatus(status),
   contentSuccess,
   challenge,
   responseTime: Date.now() - startedAt,
   finalUrl,
   title,
   error,
 };
}


function printAttemptResult(
 result: AttemptResult,
 attempts: number,
 isSuccessfulStatus: (status: number | null) => boolean
): void {
 const request = result.requestSuccess ? green("OK") : red("FAIL");
 const challengeText = result.challenge ? red("YES") : green("No");
 const content = result.contentSuccess ? green("OK") : red("FAIL");
 const statusText = result.status === null ? "-" : String(result.status);


 const status = isSuccessfulStatus(result.status)
   ? green(statusText)
   : red(statusText);


 console.log(
   `Attempt ${result.attempt}/${attempts} ` +
     `Request: ${request} | Challenge: ${challengeText} | ` +
     `Content: ${content} | Response time: ${result.responseTime} ms | ` +
     `HTTP status: ${status}`
 );


 if (result.error !== null) {
   console.log(`Error: ${red(result.error)}`);
 }
}


function printSummary(
 allResults: readonly TargetResult[],
 attempts: number
): void {
 console.log("");
 console.log(boldWhite(`Statistics after ${attempts} attempts`));
 console.log("");


 const rows = allResults.map(({ target, results }) => {
   const requests = results.filter((item) => item.requestSuccess).length;
   const contents = results.filter((item) => item.contentSuccess).length;
   const challenges = results.filter((item) => item.challenge).length;
   const total = results.length;


   return [
     target.name,
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


 printTable(
   ["Target", "AVG", "P50", "P90", "P95", "P99"],
   allResults.map(({ target, results }) => {
     const stats = calculateStats(results);


     return [
       target.name,
       formatMs(stats.avg),
       formatMs(stats.p50),
       formatMs(stats.p90),
       formatMs(stats.p95),
       formatMs(stats.p99),
     ];
   })
 );
}


export async function runRussianMode(
 options: RussianModeOptions
): Promise<void> {
 let proxyBridge: LocalProxy | null = null;
 let chromeStarted = false;


 try {
   options.validateProxyUrl(options.proxyUrl);


   console.log("");
   console.log(
     `Mode: ${
       options.proxyUrl === null
         ? "DIRECT"
         : options.maskProxyUrl(options.proxyUrl)
     }`
   );
   console.log(`Attempts: ${options.attempts}`);
   console.log("Context mode: EXISTING CHROME PROFILE");
   console.log("");


   if (options.proxyUrl !== null) {
     proxyBridge = await options.startProxyBridge(options.proxyUrl);
   }


   const firstService = RU_SERVICES[0];


   if (firstService === undefined) {
     throw new Error("No Russian services are configured.");
   }


   await startChrome(firstService.url, proxyBridge?.port ?? null);
   chromeStarted = true;


   // Verify the actual Chrome profile and its proxy route before benchmarking.
   const externalIP = await checkChromeInternet();


   const allResults: TargetResult[] = [];


   for (const service of RU_SERVICES) {
     console.log("");
     console.log(boldWhite(service.name));


     const results: AttemptResult[] = [];


     for (let attempt = 1; attempt <= options.attempts; attempt++) {
       const result = await runServiceAttempt(service, attempt, options);


       results.push(result);


       printAttemptResult(
         result,
         options.attempts,
         options.isSuccessfulStatus
       );


       if (attempt < options.attempts) {
         await sleep(options.attemptDelayMs);
       }
     }


     allResults.push({ target: service, results });
   }


   printSummary(allResults, options.attempts);


   const output = {
     mode: options.proxyUrl === null ? "DIRECT" : "SOCKS5",
     proxy:
       options.proxyUrl === null
         ? null
         : options.maskProxyUrl(options.proxyUrl),
     externalIP,
     attempts: options.attempts,
     contextMode: "EXISTING_CHROME_PROFILE",
     generatedAt: new Date().toISOString(),
     targets: allResults.map(({ target, results }) => ({
       name: target.name,
       url: target.url,
       results,
       stats: calculateStats(results),
     })),
   };


   await writeFile(
     options.outputFile,
     JSON.stringify(output, null, 2),
     "utf8"
   );


   console.log("");
   console.log(`Results saved to ${options.outputFile}`);
 } catch (error) {
   console.error("");
   console.error("RU benchmark failed:");
   console.error(getErrorMessage(error));
   process.exitCode = 1;
 } finally {
   if (chromeStarted) {
     await stopChrome().catch(() => {});
   }


   await options.stopProxyBridge(proxyBridge);
 }
}


