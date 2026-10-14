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
 * `document.readyState` of the page. Returns `null` when it cannot be read,
 * for example while the page is navigating.
 */
export async function getReadyState(page: PageReader): Promise<string | null> {
  try {
    const value = await page.evaluate("document.readyState");

    return typeof value === "string" ? value : null;
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
   * Antibots such as Avito's show their captcha dialog on top of the already
   * visible content while the page is still loading, so content is accepted
   * early only when the page also finished loading. Otherwise the whole
   * window is observed first, because a page may never report `complete`.
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

  /*
   * `requireLoaded` is dropped for the final check at the end of the window.
   * Some pages (Avito through a proxy) never reach `readyState: complete`
   * while being fully usable, so waiting for it forever would fail them.
   */
  const isSettled = async (requireLoaded: boolean): Promise<boolean> => {
    if (options.challengeStatuses === undefined) {
      return true;
    }

    const status = await getNavigationStatus(page);

    if (status === null || isChallengeStatus(status, options.challengeStatuses)) {
      return false;
    }

    return !requireLoaded || (await getReadyState(page)) === "complete";
  };

  /*
   * True while the previous poll saw a challenge. When it disappears, the
   * page gets a fresh window to load instead of the rest of the challenge
   * window, which includes the time a person needed to solve the captcha.
   */
  let challengeShownLastPoll = false;

  if (options.challengeDetected === true) {
    challengeDetected = true;

    deadline = Date.now() + CONFIG.challengeWaitTimeoutMs;

    logChallengeNotice();

    challengeLogged = true;
  }

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
        logChallengeNotice();

        challengeLogged = true;
      }

      challengeShownLastPoll = true;

      await sleep(CONFIG.contentCheckIntervalMs);

      continue;
    }

    /*
     * Challenge disappeared.
     *
     * Only now can expected content be considered
     * a successful result.
     */
    if (challengeShownLastPoll) {
      challengeShownLastPoll = false;

      // Replaces, not extends: what is left of the challenge window is not
      // waited out once the challenge is gone.
      deadline = Date.now() + CONFIG.contentWaitTimeoutMs;
    }

    if (currentContent && (await isSettled(true))) {
      return { success: true, challenge: challengeDetected };
    }

    await sleep(CONFIG.contentCheckIntervalMs);
  }

  /*
   * Final check after timeout.
   */
  const finalText = await getPageText(page);

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
      (await isSettled(false)),
    challenge: challengeDetected,
  };
}
