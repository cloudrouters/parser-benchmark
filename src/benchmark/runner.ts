import { getContextOptions } from "../browser/context.js";
import type { BrowserLike, ContextLike, PageLike } from "../browser/types.js";
import {
  containsChallenge,
  getNavigationStatus,
  getPageText,
  isChallengeStatus,
  isSuccessfulStatus,
  waitForExpectedContent,
  waitForRealNavigation,
} from "../checks/page-checks.js";
import { formatAttemptResult } from "../report/format.js";
import type { AttemptResult } from "../results/types.js";
import { boldWhite } from "../shared/ansi.js";
import { CONFIG } from "../shared/config.js";
import {
  getErrorMessage,
  ignoreCleanupError,
  sleep,
} from "../shared/utils.js";
import type { Target } from "../targets/types.js";

/**
 * Prefix of the error recorded for an attempt whose page never left about:*.
 * `runTarget` relies on it to detect a target that cannot be reached at all.
 */
const NAVIGATION_STUCK_ERROR_PREFIX = "Page remained on";

interface NavigationOutcome {
  status: number | null;
  error: string | null;
  stuck: boolean;
}

async function navigate(page: PageLike, url: string): Promise<NavigationOutcome> {
  let status: number | null = null;
  let error: string | null = null;
  let stuck = false;

  try {
    const response = await page.goto(url, {
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
        stuck = true;

        const seconds = String(CONFIG.navigationRecoveryTimeoutMs / 1000);

        error =
          `${NAVIGATION_STUCK_ERROR_PREFIX} "${page.url()}" ` +
          `for ${seconds} seconds.`;

        console.log(
          `Navigation did not complete within ${seconds} seconds. Retrying...`
        );
      }
    }
  } catch (caughtError) {
    error = getErrorMessage(caughtError);
  }

  return { status, error, stuck };
}

export async function saveChallengeDiagnostics(
  page: PageLike,
  target: Target,
  attempt: number
): Promise<void> {
  if (target.saveDiagnostics !== true) {
    return;
  }

  console.log("");

  console.log(`Challenge diagnostics for attempt ${String(attempt)}:`);

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
    const screenshotPath = `${target.name.toLowerCase()}-challenge-${String(
      attempt
    )}.png`;

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

export async function runAttempt(
  browser: BrowserLike,
  target: Target,
  attempt: number,
  localPort: string | null,
  context?: ContextLike
): Promise<AttemptResult> {
  const ownsContext = context === undefined;

  const activeContext =
    context ?? (await browser.newContext(getContextOptions(localPort)));

  const page = await activeContext.newPage();

  const startedAt = Date.now();

  try {
    const navigation = await navigate(page, target.url);

    let requestSuccess = false;

    let contentSuccess = false;

    let challenge = false;

    /*
     * For a challenge status the reported status becomes the one of the
     * document that delivered the content, once the challenge page is gone.
     */
    let settledStatus: number | null = null;

    /*
     * Some sites answer with a dedicated status (such as Wildberries' 498)
     * while their antibot checks the browser, then show the real content.
     * That response was delivered, so the attempt waits for the challenge.
     */
    const challengeStatus = isChallengeStatus(
      navigation.status,
      target.challengeStatuses
    );

    if (
      !navigation.stuck &&
      (isSuccessfulStatus(navigation.status) || challengeStatus)
    ) {
      requestSuccess = true;

      const contentResult = await waitForExpectedContent(
        page,
        target.content,
        {
          challengeDetected: challengeStatus,
          ...(target.challengeStatuses === undefined
            ? {}
            : { challengeStatuses: target.challengeStatuses }),
        }
      );

      if (challengeStatus && contentResult.success) {
        settledStatus = await getNavigationStatus(page);
      }

      contentSuccess = contentResult.success;

      challenge = contentResult.challenge;

      // #region agent log
      fetch('http://127.0.0.1:7662/ingest/262fa771-ba2b-4567-970b-5ade7a07902d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c64b0c'},body:JSON.stringify({sessionId:'c64b0c',runId:'run2',hypothesisId:'H1,H2,H3',location:'runner.ts:attemptResult',message:'attempt outcome',data:{attempt,initialStatus:navigation.status,challengeStatus,contentSuccess,challenge,url:page.url()},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } else if (!navigation.stuck) {
      challenge = containsChallenge(await getPageText(page));
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
      status: navigation.stuck ? null : (settledStatus ?? navigation.status),
      requestSuccess,
      contentSuccess,
      challenge,
      responseTime,
      finalUrl,
      title,
      error: navigation.error,
    };
  } finally {
    /*
     * The Browser and, when a shared context is passed in,
     * the BrowserContext remain alive. Only the current Page
     * and a context created for this attempt are closed.
     */
    await page.close().catch(ignoreCleanupError);

    if (ownsContext) {
      await activeContext.close().catch(ignoreCleanupError);
    }
  }
}

function isNavigationStuck(result: AttemptResult): boolean {
  return result.error?.includes(NAVIGATION_STUCK_ERROR_PREFIX) === true;
}

export async function runTarget(
  browser: BrowserLike,
  target: Target,
  localPort: string | null,
  reuseContext: boolean
): Promise<AttemptResult[]> {
  console.log("");

  console.log(boldWhite(target.name));

  const results: AttemptResult[] = [];

  let sharedContext: ContextLike | null = null;

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

      console.log(formatAttemptResult(result));

      /*
       * If every attempt has failed because the page
       * remained on about:* instead of navigating to
       * the target, stop the benchmark with an error.
       */
      if (attempt === CONFIG.attempts && results.every(isNavigationStuck)) {
        throw new Error(
          `${target.name} navigation failed ` +
            `${String(CONFIG.attempts)} consecutive times. ` +
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
      await sharedContext.close().catch(ignoreCleanupError);
    }
  }
}
