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

export async function getPageText(page: PageReader): Promise<string> {
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

export async function waitForExpectedContent(
  page: PageReader,
  expectedContent: readonly string[]
): Promise<ContentCheckResult> {
  let deadline = Date.now() + CONFIG.contentWaitTimeoutMs;

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
          `Challenge detected. Waiting up to ${String(
            CONFIG.challengeWaitTimeoutMs / 1000
          )} seconds for automatic resolution...`
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
    success: containsExpectedContent(finalText, expectedContent),
    challenge: challengeDetected,
  };
}
