import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  containsChallenge,
  containsExpectedContent,
  getNavigationStatus,
  getPageText,
  getReadyState,
  isChallengeStatus,
  isRealHttpUrl,
  isSuccessfulStatus,
  waitForExpectedContent,
  waitForRealNavigation,
} from "../../src/checks/page-checks.js";
import { CONFIG } from "../../src/shared/config.js";
import { createFakePage, createResponse } from "../helpers/fakes.js";

describe("isSuccessfulStatus", () => {
  it.each([
    [200, true],
    [204, true],
    [301, true],
    [399, true],
    [199, false],
    [400, false],
    [403, false],
    [500, false],
  ])("treats HTTP %i as success=%s", (status, expected) => {
    expect(isSuccessfulStatus(status)).toBe(expected);
  });

  it("treats a missing status as failure", () => {
    expect(isSuccessfulStatus(null)).toBe(false);
  });
});

describe("isRealHttpUrl", () => {
  it.each([
    ["https://www.google.com/", true],
    ["http://example.com", true],
    ["about:blank", false],
    ["about:neterror", false],
    ["chrome-error://chromewebdata/", false],
    ["not a url", false],
    ["", false],
  ])("returns the right verdict for %j", (url, expected) => {
    expect(isRealHttpUrl(url)).toBe(expected);
  });
});

describe("containsChallenge", () => {
  it.each([
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
    "проверяем браузер",
    "подозрительная активность",
    "подозрительную активность",
    "доступ ограничен",
  ])("detects the %j indicator", (pattern) => {
    expect(containsChallenge(`some text ${pattern} more text`)).toBe(true);
  });

  it("returns false for a regular page", () => {
    expect(containsChallenge("welcome to google search")).toBe(false);
  });

  it("expects already lower-cased text", () => {
    expect(containsChallenge("JUST A MOMENT")).toBe(false);
  });
});

describe("isChallengeStatus", () => {
  it("recognises a status listed by the target", () => {
    expect(isChallengeStatus(498, [498])).toBe(true);
  });

  it("rejects a status the target does not list", () => {
    expect(isChallengeStatus(403, [498])).toBe(false);
    expect(isChallengeStatus(200, [498])).toBe(false);
  });

  it("rejects a missing status", () => {
    expect(isChallengeStatus(null, [498])).toBe(false);
  });

  it("rejects every status for a target without challenge statuses", () => {
    expect(isChallengeStatus(498, undefined)).toBe(false);
    expect(isChallengeStatus(498, [])).toBe(false);
  });
});

describe("containsExpectedContent", () => {
  it("finds expected content regardless of its case", () => {
    expect(containsExpectedContent("welcome to booking.com", ["Booking.com"]))
      .toBe(true);
  });

  it("succeeds when at least one expected value is present", () => {
    expect(containsExpectedContent("only bing here", ["Google", "Bing"]))
      .toBe(true);
  });

  it("fails when no expected value is present", () => {
    expect(containsExpectedContent("nothing relevant", ["Google"])).toBe(false);
  });

  it("fails for an empty list of expected values", () => {
    expect(containsExpectedContent("anything", [])).toBe(false);
  });
});

describe("getPageText", () => {
  it("joins the title and body in lower case", async () => {
    const page = createFakePage({
      title: () => Promise.resolve("My Title"),
      body: () => Promise.resolve("Body TEXT"),
    });

    await expect(getPageText(page)).resolves.toBe("my title\nbody text\n");
  });

  it("falls back to the body when the title cannot be read", async () => {
    const page = createFakePage({
      title: () => Promise.reject(new Error("closed")),
      body: () => Promise.resolve("Body"),
    });

    await expect(getPageText(page)).resolves.toBe("\nbody\n");
  });

  it("falls back to the title when the body cannot be read", async () => {
    const page = createFakePage({
      title: () => Promise.resolve("Title"),
      body: () => Promise.reject(new Error("timeout")),
    });

    await expect(getPageText(page)).resolves.toBe("title\n\n");
  });

  it("includes markup that is not in the visible text", async () => {
    const page = createFakePage({
      title: () => Promise.resolve(""),
      body: () => Promise.resolve(""),
      html: () =>
        Promise.resolve(
          '<header><img alt="Wildberries" src="/logo.svg"></header>'
        ),
    });

    await expect(getPageText(page)).resolves.toContain("wildberries");
  });

  it("still finds expected content in markup that is not in the visible text", async () => {
    const page = createFakePage({
      title: () => Promise.resolve("Дзен — главная"),
      body: () => Promise.resolve("Новости и статьи"),
      html: () =>
        Promise.resolve(
          '<script src="https://smartcaptcha.yandexcloud.net/captcha.js"></script>'
        ),
    });

    const text = await getPageText(page);

    expect(containsExpectedContent(text, ["Дзен"])).toBe(true);
    expect(text).toContain("captcha");
  });

  it("returns text without content when nothing can be read", async () => {
    const page = createFakePage({
      title: () => Promise.reject(new Error("closed")),
      body: () => Promise.reject(new Error("closed")),
    });

    const text = await getPageText(page);

    expect(text.trim()).toBe("");
  });
});

describe("getPageText address handling", () => {
  it("does not let the page's own address count as page text", async () => {
    const page = createFakePage({
      url: () => "https://www.wildberries.ru/",
      title: () => Promise.resolve("loading https://www.wildberries.ru/"),
      body: () => Promise.resolve(""),
    });

    await expect(getPageText(page)).resolves.toBe("loading \n\n");
  });

  it("keeps the text unchanged when the address cannot be read", async () => {
    const page = createFakePage({
      url: () => {
        throw new Error("page closed");
      },
      title: () => Promise.resolve("My Title"),
      body: () => Promise.resolve("Body TEXT"),
    });

    await expect(getPageText(page)).resolves.toBe("my title\nbody text\n");
  });
});

describe("getNavigationStatus", () => {
  it("returns the status reported by the page", async () => {
    const page = createFakePage({ navigationStatus: () => 498 });

    await expect(getNavigationStatus(page)).resolves.toBe(498);
  });

  it("treats a zero status as unknown", async () => {
    const page = createFakePage({ navigationStatus: () => 0 });

    await expect(getNavigationStatus(page)).resolves.toBeNull();
  });

  it("treats a missing status as unknown", async () => {
    const page = createFakePage({ navigationStatus: () => null });

    await expect(getNavigationStatus(page)).resolves.toBeNull();
  });

  it("treats a failed read during navigation as unknown", async () => {
    const page = createFakePage();

    page.evaluate = () =>
      Promise.reject(new Error("Execution context was destroyed"));

    await expect(getNavigationStatus(page)).resolves.toBeNull();
  });

  it("treats a non-numeric answer as unknown", async () => {
    const page = createFakePage();

    page.evaluate = () => Promise.resolve("498");

    await expect(getNavigationStatus(page)).resolves.toBeNull();
  });
});

describe("getReadyState", () => {
  it("returns the load state reported by the page", async () => {
    const page = createFakePage({ readyState: () => "interactive" });

    await expect(getReadyState(page)).resolves.toBe("interactive");
  });

  it("treats a failed read during navigation as unknown", async () => {
    const page = createFakePage();

    page.evaluate = () =>
      Promise.reject(new Error("Execution context was destroyed"));

    await expect(getReadyState(page)).resolves.toBeNull();
  });

  it("treats a non-string answer as unknown", async () => {
    const page = createFakePage();

    page.evaluate = () => Promise.resolve(200);

    await expect(getReadyState(page)).resolves.toBeNull();
  });
});

describe("waitForRealNavigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true immediately when the page already has an http url", async () => {
    const page = createFakePage({ url: () => "https://example.com/" });

    await expect(waitForRealNavigation(page)).resolves.toBe(true);
  });

  it("returns true when the url becomes real before the deadline", async () => {
    const startedAt = Date.now();
    const page = createFakePage({
      url: () =>
        Date.now() - startedAt >= 1_000
          ? "https://example.com/"
          : "about:blank",
    });

    const result = waitForRealNavigation(page);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe(true);
  });

  it("returns false after the recovery timeout when the page stays on about:blank", async () => {
    const startedAt = Date.now();
    const page = createFakePage({ url: () => "about:blank" });

    const result = waitForRealNavigation(page);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe(false);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      CONFIG.navigationRecoveryTimeoutMs
    );
  });

  it("returns false when the url cannot be read", async () => {
    const page = createFakePage({
      url: () => {
        throw new Error("page closed");
      },
    });

    await expect(waitForRealNavigation(page)).resolves.toBe(false);
  });
});

describe("waitForExpectedContent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("succeeds immediately when the expected content is present", async () => {
    const page = createFakePage({ body: () => Promise.resolve("Welcome to Google") });

    await expect(waitForExpectedContent(page, ["Google"])).resolves.toEqual({
      success: true,
      challenge: false,
    });
  });

  it("fails without a challenge when the content never appears", async () => {
    const startedAt = Date.now();
    const page = createFakePage({ body: () => Promise.resolve("Something else") });

    const result = waitForExpectedContent(page, ["Google"]);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: false, challenge: false });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      CONFIG.contentWaitTimeoutMs
    );
  });

  it("succeeds with challenge=true when the challenge resolves after the normal timeout", async () => {
    const startedAt = Date.now();
    const challengeDurationMs = CONFIG.contentWaitTimeoutMs * 2;
    const page = createFakePage({
      body: () =>
        Promise.resolve(
          Date.now() - startedAt < challengeDurationMs
            ? "Just a moment..."
            : "Welcome to Google"
        ),
    });

    const result = waitForExpectedContent(page, ["Google"]);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: true, challenge: true });
  });

  it("does not count expected content as success while the challenge is present", async () => {
    // eBay's challenge page itself contains the word "eBay".
    const page = createFakePage({
      title: () => Promise.resolve("Checking your browser - eBay"),
      body: () => Promise.resolve("Please wait. eBay needs to verify you are human"),
    });

    const result = waitForExpectedContent(page, ["eBay"]);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: false, challenge: true });
  });

  it("waits for the challenge timeout before giving up", async () => {
    const startedAt = Date.now();
    const page = createFakePage({ body: () => Promise.resolve("Access denied") });

    const result = waitForExpectedContent(page, ["Google"]);

    await vi.runAllTimersAsync();

    await result;

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      CONFIG.challengeWaitTimeoutMs
    );
  });

  it("reports a resolved challenge without the expected content as a failure", async () => {
    const startedAt = Date.now();
    const page = createFakePage({
      body: () =>
        Promise.resolve(
          Date.now() - startedAt < 1_000 ? "Just a moment..." : "Unrelated page"
        ),
    });

    const result = waitForExpectedContent(page, ["Google"]);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: false, challenge: true });
  });

  it("logs the challenge notice only once", async () => {
    const page = createFakePage({ body: () => Promise.resolve("Access denied") });

    const result = waitForExpectedContent(page, ["Google"]);

    await vi.runAllTimersAsync();

    await result;

    expect(console.log).toHaveBeenNthCalledWith(
      1,
      "Challenge detected. Waiting up to 30 seconds for automatic resolution..."
    );
    expect(console.log).toHaveBeenNthCalledWith(
      2,
      "Challenge still present. Reloading the tab..."
    );
  });

  describe("when the challenge was already detected by the caller", () => {
    it("reports success with challenge=true once the expected content shows up", async () => {
      const page = createFakePage({
        body: () => Promise.resolve("Welcome to Wildberries"),
      });

      const result = waitForExpectedContent(page, ["Wildberries"], {
        challengeDetected: true,
      });

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({
        success: true,
        challenge: true,
      });
    });

    it("keeps waiting through blank pages for the challenge timeout instead of the content timeout", async () => {
      const startedAt = Date.now();
      const blankDurationMs = CONFIG.contentWaitTimeoutMs + 2_000;
      const page = createFakePage({
        body: () =>
          Promise.resolve(
            Date.now() - startedAt < blankDurationMs ? "" : "Welcome to Wildberries"
          ),
      });

      const result = waitForExpectedContent(page, ["Wildberries"], {
        challengeDetected: true,
      });

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
    });

    it("fails with challenge=true after the challenge timeout when content never appears", async () => {
      const startedAt = Date.now();
      const page = createFakePage({ body: () => Promise.resolve("") });

      const result = waitForExpectedContent(page, ["Wildberries"], {
        challengeDetected: true,
      });

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: false, challenge: true });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
        CONFIG.challengeWaitTimeoutMs
      );
    });

    it("logs the challenge notice exactly once", async () => {
      const page = createFakePage({
        body: () => Promise.resolve("Подозрительная активность"),
      });

      const result = waitForExpectedContent(page, ["Wildberries"], {
        challengeDetected: true,
      });

      await vi.runAllTimersAsync();

      await result;

      expect(console.log).toHaveBeenNthCalledWith(
        1,
        "Challenge detected. Waiting up to 30 seconds for automatic resolution..."
      );
      expect(console.log).toHaveBeenNthCalledWith(
        2,
        "Challenge still present. Reloading the tab..."
      );
    });
  });

  it("does not accept the page address as expected content", async () => {
    const page = createFakePage({
      url: () => "https://www.google.com/",
      title: () => Promise.resolve("loading https://www.google.com/"),
      body: () => Promise.resolve(""),
    });

    const result = waitForExpectedContent(page, ["Google"]);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: false, challenge: false });
  });

  describe("when the target serves a challenge status", () => {
    const options = { challengeDetected: true, challengeStatuses: [498] };

    it("waits until the navigation status leaves the challenge status", async () => {
      const startedAt = Date.now();
      const page = createFakePage({
        body: () => Promise.resolve("Welcome to Wildberries"),
        navigationStatus: () => (Date.now() - startedAt < 2_000 ? 498 : 200),
      });

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2_000);
    });

    it("does not accept content while the navigation status is unknown", async () => {
      const page = createFakePage({
        body: () => Promise.resolve("Welcome to Wildberries"),
      });

      page.evaluate = () => Promise.reject(new Error("navigating"));

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: false, challenge: true });
    });

    it("fails when the page keeps the challenge status", async () => {
      const page = createFakePage({
        body: () => Promise.resolve("Welcome to Wildberries"),
        navigationStatus: () => 498,
      });

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: false, challenge: true });
    });

    /*
     * Observed: Wildberries can stay on its 498 "Проверяем браузер" stub
     * for the whole 30 s window. Reloading the same tab gives the check
     * another chance without opening a new profile.
     */
    it("reloads the tab once when the challenge is still showing after the challenge window", async () => {
      const startedAt = Date.now();
      const reloadedAt = CONFIG.challengeWaitTimeoutMs;
      const contentAt = reloadedAt + 2_000;
      const page = createFakePage({
        body: () =>
          Promise.resolve(
            Date.now() - startedAt < contentAt
              ? "...\nПроверяем браузер"
              : "Интернет-магазин Wildberries"
          ),
        navigationStatus: () => (Date.now() - startedAt < contentAt ? 498 : 200),
      });

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
      expect(page.reload).toHaveBeenCalledTimes(1);
      expect(page.reload).toHaveBeenCalledWith({
        waitUntil: "domcontentloaded",
        timeout: CONFIG.pageTimeoutMs,
      });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(contentAt);
    });

    it("does not reload again when the challenge is still showing after the second window", async () => {
      const page = createFakePage({
        body: () => Promise.resolve("...\nПроверяем браузер"),
        navigationStatus: () => 498,
      });

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: false, challenge: true });
      expect(page.reload).toHaveBeenCalledTimes(1);
      expect(Date.now()).toBeGreaterThanOrEqual(
        CONFIG.challengeWaitTimeoutMs * 2
      );
    });

    it("accepts content that is already on the page even while it is still loading", async () => {
      const startedAt = Date.now();
      const page = createFakePage({
        body: () => Promise.resolve("Welcome to Wildberries"),
        readyState: () => "interactive",
      });

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    });

    /*
     * Regression: through a proxy Avito stays on `readyState: interactive`
     * for as long as it is observed (logged: 30 s), although the page, its
     * content and its status were fine. Waiting for `complete` forever
     * reported such an attempt as Content: FAIL.
     */
    it("accepts delivered content at the end of the window when the page never reaches the complete load state", async () => {
      const startedAt = Date.now();
      const page = createFakePage({
        body: () => Promise.resolve("Welcome to Wildberries"),
        readyState: () => "interactive",
      });

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    });

    it("accepts delivered content at the end of the window when the load state is unknown", async () => {
      const page = createFakePage({
        body: () => Promise.resolve("Welcome to Wildberries"),
      });

      page.evaluate = (expression) =>
        expression.includes("readyState")
          ? Promise.reject(new Error("navigating"))
          : Promise.resolve(200);

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
    });
  });

  /*
   * Regression (Wildberries, logged): after its 498 check the page reloaded
   * with status 200 but stayed empty for about 27 s on a new profile; the
   * expected word appeared only together with the page title. The 5 s window
   * after the challenge reported Content: FAIL while the site was opening.
   * The page also stays on `readyState: interactive` the whole time.
   */
  describe("when the content takes long to render after the challenge (Wildberries)", () => {
    const options = { challengeDetected: true, challengeStatuses: [498] };
    const CHECK_ENDS_AT_MS = 6_000;
    const RENDERED_AT_MS = 33_000;

    function createSlowWildberries(startedAt: number, renderedAtMs: number) {
      const elapsed = (): number => Date.now() - startedAt;

      return createFakePage({
        title: () =>
          Promise.resolve(
            elapsed() >= renderedAtMs ? "Интернет-магазин Wildberries.ru" : ""
          ),
        body: () =>
          Promise.resolve(
            elapsed() < CHECK_ENDS_AT_MS ? "...\nПроверяем браузер" : ""
          ),
        navigationStatus: () => (elapsed() < CHECK_ENDS_AT_MS ? 498 : 200),
        readyState: () => "interactive",
      });
    }

    it("waits for the content for much longer than the usual window and then succeeds", async () => {
      const startedAt = Date.now();
      const page = createSlowWildberries(startedAt, RENDERED_AT_MS);

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(RENDERED_AT_MS);
      expect(Date.now() - startedAt).toBeLessThan(RENDERED_AT_MS + 1_000);
    });

    it("does not wait for the end of the long window once the content has been observed", async () => {
      const startedAt = Date.now();
      const page = createSlowWildberries(startedAt, RENDERED_AT_MS);

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await result;

      expect(Date.now() - startedAt).toBeLessThan(RENDERED_AT_MS + 1_000);
    });

    it("fails with challenge=true after the long window when the content never renders", async () => {
      const startedAt = Date.now();
      const page = createSlowWildberries(startedAt, Number.POSITIVE_INFINITY);

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: false, challenge: true });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
        CHECK_ENDS_AT_MS + CONFIG.postChallengeContentWaitTimeoutMs
      );
    });

    it("uses a 60 second window after the challenge", () => {
      expect(CONFIG.postChallengeContentWaitTimeoutMs).toBe(60_000);
    });

    it("accepts the page as soon as the header markup is there, even with an empty body", async () => {
      const startedAt = Date.now();
      const page = createFakePage({
        title: () => Promise.resolve(""),
        body: () =>
          Promise.resolve(
            Date.now() - startedAt < CHECK_ENDS_AT_MS
              ? "...\nПроверяем браузер"
              : ""
          ),
        html: () =>
          Promise.resolve(
            Date.now() - startedAt < CHECK_ENDS_AT_MS
              ? ""
              : '<header><img alt="Wildberries"></header>'
          ),
        navigationStatus: () => (Date.now() - startedAt < CHECK_ENDS_AT_MS ? 498 : 200),
        readyState: () => "interactive",
      });

      const result = waitForExpectedContent(page, ["Wildberries"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
      expect(Date.now() - startedAt).toBeLessThan(CHECK_ENDS_AT_MS + 1_000);
    });
  });

  describe("when the antibot shows its captcha after the content loaded (Avito)", () => {
    const options = { challengeDetected: true, challengeStatuses: [439, 429] };
    const CAPTCHA_DIALOG =
      "Авито — объявления. Доступ ограничен: проблема с IP. " +
      "Нажмите на кнопку Продолжить для решения капчи";

    it("accepts the content as soon as it is on the page after a challenge, even if a captcha dialog would appear later", async () => {
      const startedAt = Date.now();
      const page = createFakePage({
        body: () =>
          Promise.resolve(
            Date.now() - startedAt < 4_000 ? "Объявления на сайте Авито" : CAPTCHA_DIALOG
          ),
        readyState: () => "interactive",
      });

      const result = waitForExpectedContent(page, ["Авито"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
      expect(Date.now() - startedAt).toBeLessThan(1_500);
    });

    it("fails with challenge=true when the antibot replaces the page with its captcha stub", async () => {
      const page = createFakePage({
        title: () => Promise.resolve("Доступ ограничен: проблема с IP"),
        body: () => Promise.resolve("Нажмите на кнопку Продолжить для решения капчи"),
        navigationStatus: () => 429,
      });

      const result = waitForExpectedContent(page, ["Авито"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: false, challenge: true });
    });

    it("reports success with challenge=true when the page loads without a captcha", async () => {
      const startedAt = Date.now();
      const page = createFakePage({
        title: () =>
          Promise.resolve(
            Date.now() - startedAt < 1_000
              ? "Доступ ограничен: проверка безопасности"
              : "Авито — объявления"
          ),
        body: () =>
          Promise.resolve(
            Date.now() - startedAt < 1_000
              ? "Проверка пройдена, перенаправление..."
              : "Объявления на сайте Авито"
          ),
        navigationStatus: () => (Date.now() - startedAt < 1_000 ? 439 : 200),
        readyState: () => (Date.now() - startedAt < 3_000 ? "interactive" : "complete"),
      });

      const result = waitForExpectedContent(page, ["Авито"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
    });

    it("does not close Avito on a loading stub after the captcha", async () => {
      const startedAt = Date.now();
      const paintedAtMs = 2_000;
      const page = createFakePage({
        title: () => Promise.resolve("Авито — Объявления на сайте Авито"),
        body: () =>
          Promise.resolve(
            Date.now() - startedAt < paintedAtMs
              ? "быстрая подработка. карьера в авито"
              : "Объявления на сайте Авито"
          ),
        navigationStatus: () => 200,
        readyState: () =>
          Date.now() - startedAt < paintedAtMs ? "loading" : "interactive",
      });

      const result = waitForExpectedContent(page, ["Авито"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(paintedAtMs);
      expect(Date.now() - startedAt).toBeLessThan(paintedAtMs + 1_500);
    });

    it("accepts a painted Avito homepage that stays on readyState loading", async () => {
      const startedAt = Date.now();
      const homepage = `Объявления на сайте Авито\n${"раздел ".repeat(150)}`;
      const page = createFakePage({
        title: () => Promise.resolve("Авито — Объявления на сайте Авито"),
        body: () => Promise.resolve(homepage),
        navigationStatus: () => 200,
        readyState: () => "loading",
      });

      const result = waitForExpectedContent(page, ["Авито"], options);

      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ success: true, challenge: true });
      expect(homepage.trim().length).toBeGreaterThan(
        CONFIG.minPaintedBodyLength
      );
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
        (CONFIG.postChallengePaintedPolls - 1) * CONFIG.contentCheckIntervalMs
      );
      expect(Date.now() - startedAt).toBeLessThan(1_500);
    });

    describe("without a challenge status on the first response", () => {
      const withoutChallengeStatus = { challengeStatuses: [439, 429] };

      it("accepts a loaded page with its content when the load state stays interactive", async () => {
        const startedAt = Date.now();
        const page = createFakePage({
          body: () => Promise.resolve("Объявления на сайте Авито"),
          readyState: () => "interactive",
        });

        const result = waitForExpectedContent(
          page,
          ["Авито"],
          withoutChallengeStatus
        );

        await vi.runAllTimersAsync();

        await expect(result).resolves.toEqual({
          success: true,
          challenge: false,
        });
        expect(Date.now() - startedAt).toBeLessThan(1_000);
      });

      it("does not wait for a late captcha once the body already has its content", async () => {
        const startedAt = Date.now();
        const page = createFakePage({
          body: () =>
            Promise.resolve(
              Date.now() - startedAt < 3_000
                ? "Объявления на сайте Авито"
                : CAPTCHA_DIALOG
            ),
          readyState: () => "interactive",
        });

        const result = waitForExpectedContent(
          page,
          ["Авито"],
          withoutChallengeStatus
        );

        await vi.runAllTimersAsync();

        await expect(result).resolves.toEqual({
          success: true,
          challenge: false,
        });
        expect(Date.now() - startedAt).toBeLessThan(1_000);
      });

      it("does not accept the content while the page still reports a challenge status", async () => {
        const page = createFakePage({
          body: () => Promise.resolve("Объявления на сайте Авито"),
          navigationStatus: () => 429,
          readyState: () => "interactive",
        });

        const result = waitForExpectedContent(
          page,
          ["Авито"],
          withoutChallengeStatus
        );

        await vi.runAllTimersAsync();

        await expect(result).resolves.toEqual({
          success: false,
          challenge: false,
        });
      });
    });

    /*
     * Regression: the 30 seconds started when the captcha appeared and
     * included the time a person needed to solve it, so a page that loaded
     * after the solution had almost no time left (logged: content at 23.4 s,
     * deadline at 30.0 s).
     */
    describe("when a person solves the captcha", () => {
      it("gives the page a fresh window to load once the captcha is gone", async () => {
        const startedAt = Date.now();
        const solvedAtMs = 25_000;
        const page = createFakePage({
          body: () =>
            Promise.resolve(
              Date.now() - startedAt < solvedAtMs
                ? CAPTCHA_DIALOG
                : "Объявления на сайте Авито"
            ),
          navigationStatus: () => (Date.now() - startedAt < solvedAtMs ? 429 : 200),
          readyState: () => "interactive",
        });

        const result = waitForExpectedContent(page, ["Авито"], options);

        await vi.runAllTimersAsync();

        await expect(result).resolves.toEqual({ success: true, challenge: true });
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(solvedAtMs);
        expect(Date.now() - startedAt).toBeLessThan(solvedAtMs + 1_000);
      });

      /*
       * Regression: Avito's own check page (439) passes by itself in about
       * 1.4 s, the real page then stays unchanged and never reaches the
       * complete load state. The attempt kept waiting for what was left of
       * the 30 s challenge window (logged: 30.2 s instead of about 6.5 s).
       */
      it("does not wait out the rest of a long challenge window once the challenge is gone", async () => {
        const startedAt = Date.now();
        const goneAtMs = 1_500;
        const page = createFakePage({
          body: () =>
            Promise.resolve(
              Date.now() - startedAt < goneAtMs
                ? CAPTCHA_DIALOG
                : "Объявления на сайте Авито"
            ),
          navigationStatus: () => (Date.now() - startedAt < goneAtMs ? 439 : 200),
          readyState: () => "interactive",
        });

        const result = waitForExpectedContent(page, ["Авито"], options);

        await vi.runAllTimersAsync();

        await expect(result).resolves.toEqual({ success: true, challenge: true });

        const elapsed = Date.now() - startedAt;

        expect(elapsed).toBeGreaterThanOrEqual(goneAtMs);
        expect(elapsed).toBeLessThan(goneAtMs + 1_000);
      });

      it("accepts the content as soon as the captcha is gone, even if it would come back later", async () => {
        const startedAt = Date.now();
        const page = createFakePage({
          body: () => {
            const elapsed = Date.now() - startedAt;

            if (elapsed < 10_000) {
              return Promise.resolve(CAPTCHA_DIALOG);
            }

            if (elapsed < 12_000) {
              return Promise.resolve("Объявления на сайте Авито");
            }

            return Promise.resolve(CAPTCHA_DIALOG);
          },
          readyState: () => "interactive",
        });

        const result = waitForExpectedContent(page, ["Авито"], options);

        await vi.runAllTimersAsync();

        await expect(result).resolves.toEqual({ success: true, challenge: true });
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10_000);
        expect(Date.now() - startedAt).toBeLessThan(11_000);
      });
    });
  });

  it("does not accept a Drom title while the body is still empty", async () => {
    const startedAt = Date.now();
    const paintedAtMs = 2_000;
    const page = createFakePage({
      title: () => Promise.resolve("Дром - цены на машины"),
      body: () =>
        Promise.resolve(
          Date.now() - startedAt < paintedAtMs ? "" : "Дром - цены на машины"
        ),
      readyState: () =>
        Date.now() - startedAt < paintedAtMs ? "loading" : "interactive",
    });

    const result = waitForExpectedContent(page, ["Дром"]);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: true, challenge: false });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(paintedAtMs);
    expect(Date.now() - startedAt).toBeLessThan(paintedAtMs + 1_000);
  });

  it("reloads a Drom tab that stays on a white loading document", async () => {
    const startedAt = Date.now();
    let reloads = 0;
    const page = createFakePage({
      title: () => Promise.resolve("Дром - цены на машины"),
      body: () => Promise.resolve(reloads === 0 ? "" : "Дром - цены на машины"),
      readyState: () => (reloads === 0 ? "loading" : "interactive"),
      reload: () => {
        reloads += 1;
        return Promise.resolve(createResponse(200));
      },
    });

    const result = waitForExpectedContent(page, ["Дром"], {
      stuckReloadMs: 5_000,
    });

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: true, challenge: false });
    expect(reloads).toBe(1);
    expect(page.reload).toHaveBeenCalledWith({
      waitUntil: "domcontentloaded",
      timeout: 5_000,
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5_000);
    expect(Date.now() - startedAt).toBeLessThan(6_500);
  });

  it("does not accept a VK welcome title while the body is still empty", async () => {
    const startedAt = Date.now();
    const page = createFakePage({
      title: () => Promise.resolve("VK | Welcome!"),
      body: () => Promise.resolve(""),
      readyState: () => "interactive",
    });

    const result = waitForExpectedContent(page, ["VK"], {
      loadingContent: ["загружается"],
    });

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: false, challenge: false });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      CONFIG.challengeWaitTimeoutMs
    );
  });

  it("does not accept a VK welcome shell that is still loading", async () => {
    const startedAt = Date.now();
    const page = createFakePage({
      title: () => Promise.resolve("VK | Welcome!"),
      body: () => Promise.resolve("Search VK\nзагружается...\nHelp"),
      readyState: () => "interactive",
    });

    const result = waitForExpectedContent(page, ["VK"], {
      loadingContent: ["загружается"],
    });

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: false, challenge: false });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      CONFIG.challengeWaitTimeoutMs
    );
  });

  it("accepts VK as soon as the loading placeholder is gone", async () => {
    const startedAt = Date.now();
    const goneAtMs = 2_000;
    const page = createFakePage({
      title: () => Promise.resolve("VK | Welcome!"),
      body: () =>
        Promise.resolve(
          Date.now() - startedAt < goneAtMs
            ? "Search VK\nзагружается...\nHelp"
            : "Лента новостей ВКонтакте"
        ),
      readyState: () => "interactive",
    });

    const result = waitForExpectedContent(page, ["VK"], {
      loadingContent: ["загружается"],
    });

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: true, challenge: false });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(goneAtMs);
    expect(Date.now() - startedAt).toBeLessThan(goneAtMs + 1_000);
  });

  it("does not wait out a challenge window for a loaded Dzen page whose markup mentions captcha", async () => {
    const startedAt = Date.now();
    const page = createFakePage({
      title: () => Promise.resolve("Дзен — главная новостная информационная платформа"),
      body: () => Promise.resolve("Новости и статьи"),
      html: () =>
        Promise.resolve(
          '<script src="https://smartcaptcha.yandexcloud.net/captcha.js"></script>'
        ),
      readyState: () => "interactive",
    });

    const result = waitForExpectedContent(page, ["Дзен"]);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ success: true, challenge: false });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
