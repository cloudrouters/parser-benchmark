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
 * Expects already lower-cased visible text (title and body), not markup.
 * Script URLs such as SmartCaptcha on a loaded Dzen page must not count.
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

export function containsLoadingContent(
  text: string,
  loadingContent: readonly string[] | undefined
): boolean {
  return (
    loadingContent?.some((pattern) => text.includes(pattern.toLowerCase())) ===
    true
  );
}

/**
 * A target with `loadingContent` is still a shell while the body is empty
 * (VK paints "VK | Welcome!" before any body text) or while a placeholder
 * such as "загружается" is visible.
 */
export function isStillLoading(
  body: string,
  visible: string,
  loadingContent: readonly string[] | undefined
): boolean {
  if (loadingContent === undefined) {
    return false;
  }

  return body.trim() === "" || containsLoadingContent(visible, loadingContent);
}

/**
 * The document has something on screen: it left `loading`, or the body is
 * already a real page even if `readyState` is stuck on `loading` (Avito).
 */
export function isDocumentPainted(
  readyState: string | null,
  body: string
): boolean {
  if (readyState === "interactive" || readyState === "complete") {
    return true;
  }

  return body.trim().length >= CONFIG.minPaintedBodyLength;
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
 * Markup is included because a site such as Wildberries paints its header
 * (logo alt text, class names) before any visible body text exists.
 */
export async function getPageText(page: PageReader): Promise<string> {
  const snapshot = await readPageSnapshot(page);

  return snapshot.combined;
}

export async function getVisiblePageText(page: PageReader): Promise<string> {
  const snapshot = await readPageSnapshot(page);

  return snapshot.visible;
}

const PAGE_HTML_EXPRESSION = "document.documentElement ? document.documentElement.innerHTML : \"\"";

interface PageSnapshot {
  body: string;
  visible: string;
  combined: string;
}

async function readPageSnapshot(page: PageReader): Promise<PageSnapshot> {
  const [title, body, html] = await Promise.all([
    page.title().catch(() => ""),
    page
      .locator("body")
      .innerText({ timeout: CONFIG.contentWaitTimeoutMs })
      .catch(() => ""),
    page.evaluate(PAGE_HTML_EXPRESSION).catch(() => ""),
  ]);

  const url = readPageUrl(page);
  const stripUrl = (value: string): string =>
    url === null || url === "" ? value : value.replaceAll(url.toLowerCase(), "");
  const bodyText = stripUrl(body.toLowerCase());
  const visible = stripUrl(`${title}\n${body}`.toLowerCase());
  const markup = (typeof html === "string" ? html : "").toLowerCase();

  return {
    body: bodyText,
    visible,
    combined: stripUrl(`${visible}\n${markup}`),
  };
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
   * visible content while the page is still loading, so a page that never
   * reports `complete` (Wildberries, Avito through a proxy) is accepted as
   * soon as the expected content is in the body and the status is no longer a
   * challenge status. The wait does not sit out `readyState` or a late dialog.
   */
  challengeStatuses?: readonly number[];
  /**
   * Visible placeholders that mean the page is still a loading shell.
   * Content that matches the target is ignored until they disappear.
   */
  loadingContent?: readonly string[];
  /**
   * Reload the tab if it is still a white/loading document after this
   * many milliseconds (Drom). Playwright's `domcontentloaded` wait is not
   * used for that reload: a short timeout is enough, then polling continues.
   */
  stuckReloadMs?: number;
}

export async function waitForExpectedContent(
  page: PageReader,
  expectedContent: readonly string[],
  options: WaitForContentOptions = {}
): Promise<ContentCheckResult> {
  let deadline = Date.now() + CONFIG.contentWaitTimeoutMs;

  const waitStartedAt = Date.now();

  let didStuckReload = false;

  let challengeDetected = false;

  let challengeLogged = false;

  /*
   * `requireLoaded` is dropped for the final check at the end of the window.
   * Some pages (Avito through a proxy) never reach `readyState: complete`
   * while being fully usable, so waiting for it forever would fail them.
   * Expected content in the body is accepted without waiting for `complete`.
   */
  const isSettled = async (requireLoaded: boolean): Promise<boolean> => {
    const ready = await getReadyState(page);

    if (ready === "loading") {
      return false;
    }

    if (options.challengeStatuses === undefined) {
      return true;
    }

    const status = await getNavigationStatus(page);

    if (status === null || isChallengeStatus(status, options.challengeStatuses)) {
      return false;
    }

    return !requireLoaded || ready === "complete";
  };

  /*
   * True while the previous poll saw a challenge. When it disappears, the
   * page gets a long window to load instead of the rest of the challenge
   * window, which includes the time a person needed to solve the captcha.
   * Content is accepted once the real page has stayed painted for a
   * few polls, so the tab is not closed on the captcha-to-site frame.
   */
  let challengeShownLastPoll = false;

  let paintedPollsAfterChallenge = 0;

  let loadingLogged = false;

  if (options.challengeDetected === true) {
    challengeDetected = true;

    deadline = Date.now() + CONFIG.challengeWaitTimeoutMs;

    logChallengeNotice();

    challengeLogged = true;
  }

  while (Date.now() < deadline) {
    const snapshot = await readPageSnapshot(page);
    const text = snapshot.combined;
    const visible = snapshot.visible;

    const currentChallenge = containsChallenge(visible);

    const currentContent = containsExpectedContent(text, expectedContent);

    const ready = await getReadyState(page);
    const currentLoading =
      ready === "loading" ||
      isStillLoading(snapshot.body, visible, options.loadingContent);

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

    if (challengeShownLastPoll) {
      challengeShownLastPoll = false;
      paintedPollsAfterChallenge = 0;
      deadline = Date.now() + CONFIG.postChallengeContentWaitTimeoutMs;
    }

    const contentInBody = containsExpectedContent(
      snapshot.body,
      expectedContent
    );

    if (
      contentInBody &&
      !isStillLoading(snapshot.body, visible, options.loadingContent) &&
      isDocumentPainted(ready, snapshot.body)
    ) {
      const status =
        options.challengeStatuses === undefined
          ? undefined
          : await getNavigationStatus(page);

      if (
        status === undefined ||
        (status !== null &&
          !isChallengeStatus(status, options.challengeStatuses))
      ) {
        if (challengeDetected) {
          paintedPollsAfterChallenge += 1;

          if (
            paintedPollsAfterChallenge < CONFIG.postChallengePaintedPolls
          ) {
            await sleep(CONFIG.contentCheckIntervalMs);

            continue;
          }
        }

        return { success: true, challenge: challengeDetected };
      }
    }

    if (currentLoading) {
      if (
        options.stuckReloadMs !== undefined &&
        page.reload !== undefined &&
        !didStuckReload
      ) {
        deadline =
          waitStartedAt + options.stuckReloadMs + CONFIG.contentCheckIntervalMs;

        if (Date.now() - waitStartedAt >= options.stuckReloadMs) {
          didStuckReload = true;
          try {
            await page.reload({
              waitUntil: "domcontentloaded",
              timeout: options.stuckReloadMs,
            });
          } catch {
            // The reload itself can sit on DCL; the next polls read the tab.
          }

          deadline = Date.now() + CONFIG.challengeWaitTimeoutMs;
        }

        await sleep(CONFIG.contentCheckIntervalMs);

        continue;
      }

      if (!loadingLogged) {
        deadline = Math.max(
          deadline,
          Date.now() + CONFIG.challengeWaitTimeoutMs
        );
        loadingLogged = true;
      }

      await sleep(CONFIG.contentCheckIntervalMs);

      continue;
    }

    if (currentContent && (await isSettled(!challengeDetected))) {
      return { success: true, challenge: challengeDetected };
    }

    await sleep(CONFIG.contentCheckIntervalMs);
  }

  /*
   * Final check after timeout. A challenge that is still showing is given
   * one reload of the same tab and a second challenge window. Wildberries
   * can stay on its stub until the page is refreshed.
   */
  const finalSnapshot = await readPageSnapshot(page);
  const finalText = finalSnapshot.combined;
  const finalVisible = finalSnapshot.visible;

  const finalReady = await getReadyState(page);
  const stuckLoading = finalReady === "loading";
  const stuckChallenge = containsChallenge(finalVisible);

  if ((stuckChallenge || stuckLoading) && page.reload !== undefined) {
    if (stuckChallenge) {
      console.log("Challenge still present. Reloading the tab...");
    }

    try {
      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: CONFIG.pageTimeoutMs,
      });
    } catch {
      // A failed reload still gets a second challenge window.
    }

    deadline = Date.now() + CONFIG.challengeWaitTimeoutMs;
    challengeShownLastPoll = stuckChallenge;
    const reloadedChallenge = stuckChallenge || challengeDetected;

    while (Date.now() < deadline) {
      const snapshot = await readPageSnapshot(page);
      const text = snapshot.combined;
      const currentChallenge = containsChallenge(snapshot.visible);
      const currentContent = containsExpectedContent(text, expectedContent);

      if (currentChallenge || (await getReadyState(page)) === "loading") {
        await sleep(CONFIG.contentCheckIntervalMs);
        continue;
      }

      if (challengeShownLastPoll) {
        challengeShownLastPoll = false;
        deadline = Date.now() + CONFIG.postChallengeContentWaitTimeoutMs;
      }

      if (currentContent && (await isSettled(!challengeDetected))) {
        return { success: true, challenge: reloadedChallenge };
      }

      await sleep(CONFIG.contentCheckIntervalMs);
    }

    const afterReload = await readPageSnapshot(page);

    if (containsChallenge(afterReload.visible)) {
      return { success: false, challenge: true };
    }

    return {
      success:
        containsExpectedContent(afterReload.combined, expectedContent) &&
        (await isSettled(false)),
      challenge: reloadedChallenge,
    };
  }

  /*
   * If challenge is still present, it is a
   * genuine unresolved challenge.
   */
  if (containsChallenge(finalVisible)) {
    return { success: false, challenge: true };
  }

  if (isStillLoading(finalSnapshot.body, finalVisible, options.loadingContent)) {
    return { success: false, challenge: challengeDetected };
  }

  return {
    success:
      containsExpectedContent(finalText, expectedContent) &&
      (await isSettled(false)),
    challenge: challengeDetected,
  };
}
