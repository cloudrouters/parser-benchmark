import type { PageReader } from "../browser/types.js";
import { CHALLENGE_PATTERNS, CONFIG } from "../shared/config.js";
import { sleep } from "../shared/utils.js";

export interface ContentCheckResult {
  success: boolean;
  challenge: boolean;
}

export function isSuccessfulStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 400;
}

export function isChallengeStatus(
  status: number | null,
  challengeStatuses: readonly number[] | undefined
): boolean {
  return status !== null && challengeStatuses?.includes(status) === true;
}

export function isRealHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Expects text that is already lower-cased, as returned by `getPageText`.
 */
export function containsChallenge(text: string): boolean {
  return CHALLENGE_PATTERNS.some((pattern) => text.includes(pattern));
}

export function containsExpectedContent(
  text: string,
  expectedContent: readonly string[]
): boolean {
  return expectedContent.some((content) =>
    text.includes(content.toLowerCase())
  );
}

function readPageUrl(page: PageReader): string | null {
  try {
    return page.url();
  } catch {
    // The page is gone, so there is no address to exclude.
    return null;
  }
}

const NAVIGATION_STATUS_EXPRESSION =
  '(performance.getEntriesByType("navigation")[0] ?? {}).responseStatus ?? null';

/**
 * HTTP status of the document that the page currently shows. After a reload
 * this is the status of the reloaded document, not of the first navigation.
 * Returns `null` when the status is unknown, for example while the page is
 * navigating and its execution context is gone.
 */
export async function getNavigationStatus(
  page: PageReader
): Promise<number | null> {
  try {
    const value = await page.evaluate(NAVIGATION_STATUS_EXPRESSION);

    return typeof value === "number" && value > 0 ? value : null;
  } catch {
    // Reading fails while the page navigates; the caller polls again.
    return null;
  }
}

/**
 * The page's own address is not page content: a loading page titled
 * "loading https://www.example.com/" must not satisfy a check for "example".
 */
export async function getPageText(page: PageReader): Promise<string> {
  const text = await readRawPageText(page);

  const url = readPageUrl(page);

  return url === null || url === ""
    ? text
    : text.replaceAll(url.toLowerCase(), "");
}

async function readRawPageText(page: PageReader): Promise<string> {
  const [title, body] = await Promise.all([
    page.title().catch(() => ""),
    page
      .locator("body")
      .innerText({ timeout: CONFIG.contentWaitTimeoutMs })
      .catch(() => ""),
  ]);

  return `${title}\n${body}`.toLowerCase();
}

function hasRealHttpUrl(page: PageReader): boolean | null {
  try {
    return isRealHttpUrl(page.url());
  } catch {
    // The page is gone, so it can never reach a real URL.
    return null;
  }
}

export async function waitForRealNavigation(
  page: PageReader
): Promise<boolean> {
  const deadline = Date.now() + CONFIG.navigationRecoveryTimeoutMs;

  while (Date.now() < deadline) {
    const hasRealUrl = hasRealHttpUrl(page);

    if (hasRealUrl === null) {
      return false;
    }

    if (hasRealUrl) {
      return true;
    }

    await sleep(CONFIG.contentCheckIntervalMs);
  }

  return hasRealHttpUrl(page) === true;
}

function logChallengeNotice(): void {
  console.log(
    `Challenge detected. Waiting up to ${String(
      CONFIG.challengeWaitTimeoutMs / 1000
    )} seconds for automatic resolution...`
  );
}

export interface WaitForContentOptions {
  /**
   * The caller already knows that a challenge is being served (for example
   * from the HTTP status). The longer challenge timeout then applies from
   * the start, so blank pages between challenge stages do not end the wait.
   */
  challengeDetected?: boolean;
  /**
   * Statuses that the target serves together with its challenge page. When
   * given, content only counts once the page itself reports a status that is
   * not one of them, that is, once the challenge page has been replaced.
   */
  challengeStatuses?: readonly number[];
}

export async function waitForExpectedContent(
  page: PageReader,
  expectedContent: readonly string[],
  options: WaitForContentOptions = {}
): Promise<ContentCheckResult> {
  let deadline = Date.now() + CONFIG.contentWaitTimeoutMs;

  let challengeDetected = false;

  let challengeLogged = false;

  const isSettled = async (): Promise<boolean> => {
    if (options.challengeStatuses === undefined) {
      return true;
    }

    const status = await getNavigationStatus(page);

    return status !== null && !isChallengeStatus(status, options.challengeStatuses);
  };

  if (options.challengeDetected === true) {
    challengeDetected = true;

    deadline = Date.now() + CONFIG.challengeWaitTimeoutMs;

    logChallengeNotice();

    challengeLogged = true;
  }

  // #region agent log
  const dbgStartedAt = Date.now();
  let dbgLastSignature = "";
  // #endregion

  while (Date.now() < deadline) {
    const text = await getPageText(page);

    const currentChallenge = containsChallenge(text);

    const currentContent = containsExpectedContent(text, expectedContent);

    // #region agent log
    {
      const dbgNavStatus = await getNavigationStatus(page);
      let dbgSnapshot = "n/a";
      try {
        dbgSnapshot = String(await page.evaluate("JSON.stringify({readyState:document.readyState,title:document.title,bodyLen:document.body?document.body.innerText.length:0,htmlLen:document.documentElement.outerHTML.length})"));
      } catch (dbgError) {
        dbgSnapshot = `evaluate failed: ${dbgError instanceof Error ? dbgError.message.slice(0, 100) : String(dbgError)}`;
      }
      const dbgSignature = `${String(currentChallenge)}|${String(currentContent)}|${String(dbgNavStatus)}|${text.slice(0, 80)}|${dbgSnapshot}`;
      if (dbgSignature !== dbgLastSignature) {
        dbgLastSignature = dbgSignature;
        fetch('http://127.0.0.1:7662/ingest/262fa771-ba2b-4567-970b-5ade7a07902d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c64b0c'},body:JSON.stringify({sessionId:'c64b0c',runId:'run2',hypothesisId:'H1,H2,H3,H4',location:'page-checks.ts:poll',message:'poll state changed',data:{elapsedMs:Date.now()-dbgStartedAt,textLen:text.length,textHead:text.slice(0,200),currentChallenge,currentContent,dbgNavStatus,challengeDetected,snapshot:dbgSnapshot},timestamp:Date.now()})}).catch(()=>{});
      }
    }
    // #endregion

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
        logChallengeNotice();

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
    if (currentContent && (await isSettled())) {
      return { success: true, challenge: challengeDetected };
    }

    await sleep(CONFIG.contentCheckIntervalMs);
  }

  /*
   * Final check after timeout.
   */
  const finalText = await getPageText(page);

  // #region agent log
  fetch('http://127.0.0.1:7662/ingest/262fa771-ba2b-4567-970b-5ade7a07902d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c64b0c'},body:JSON.stringify({sessionId:'c64b0c',runId:'run2',hypothesisId:'H1,H4',location:'page-checks.ts:timeout',message:'wait ended by deadline',data:{elapsedMs:Date.now()-dbgStartedAt,finalHasChallengeText:containsChallenge(finalText),finalHasContent:containsExpectedContent(finalText, expectedContent),finalNavStatus:await getNavigationStatus(page),challengeDetectedFlag:challengeDetected,textHead:finalText.slice(0,200)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  /*
   * If challenge is still present, it is a
   * genuine unresolved challenge.
   */
  if (containsChallenge(finalText)) {
    return { success: false, challenge: true };
  }

  return {
    success:
      containsExpectedContent(finalText, expectedContent) &&
      (await isSettled()),
    challenge: challengeDetected,
  };
}
