import { getContextOptions } from "../browser/context.js";
import type { BrowserLike } from "../browser/types.js";
import { cyan, green } from "../shared/ansi.js";
import { CONFIG } from "../shared/config.js";
import { getErrorMessage, ignoreCleanupError } from "../shared/utils.js";
import { isSuccessfulStatus } from "./page-checks.js";

interface IpifyResponse {
  ip: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseIpifyResponse(value: unknown): IpifyResponse {
  if (
    !isRecord(value) ||
    typeof value.ip !== "string" ||
    value.ip.trim() === ""
  ) {
    throw new Error("IP address was not found in response.");
  }

  return { ip: value.ip.trim() };
}

/**
 * Returns the external IP address, or `null` when the connection check fails.
 * The failure reason is reported to stderr.
 */
export async function checkInternet(
  browser: BrowserLike,
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
      throw new Error(`IP check returned HTTP ${String(status)}.`);
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
    await context.close().catch(ignoreCleanupError);
  }
}
