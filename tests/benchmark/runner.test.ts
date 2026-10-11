import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runAttempt,
  runTarget,
  saveChallengeDiagnostics,
} from "../../src/benchmark/runner.js";
import { getContextOptions } from "../../src/browser/context.js";
import { formatAttemptResult } from "../../src/report/format.js";
import { CONFIG } from "../../src/shared/config.js";
import {
  createFakeBrowser,
  createFakeContext,
  createFakePage,
  createResponse,
  type FakePage,
  type FakePageOptions,
} from "../helpers/fakes.js";
import { createTarget } from "../helpers/fixtures.js";

const EBAY = createTarget({
  name: "eBay",
  url: "https://www.ebay.com/",
  content: ["eBay"],
  saveDiagnostics: true,
});

const WILDBERRIES = createTarget({
  name: "Wildberries",
  url: "https://www.wildberries.ru/",
  content: ["Wildberries"],
  saveDiagnostics: true,
  challengeStatuses: [498],
});

function createPageWithBody(
  body: string,
  options: FakePageOptions = {}
): FakePage {
  return createFakePage({ body: () => Promise.resolve(body), ...options });
}

function loggedLines(): unknown[] {
  return vi.mocked(console.log).mock.calls.map((call): unknown => call[0]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runAttempt", () => {
  it("reports a successful attempt", async () => {
    const page = createPageWithBody("Welcome to Example");
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const result = await runAttempt(browser, createTarget(), 1, null);

    expect(result).toEqual({
      attempt: 1,
      status: 200,
      requestSuccess: true,
      contentSuccess: true,
      challenge: false,
      responseTime: 0,
      finalUrl: "https://example.com/",
      title: "Example",
      error: null,
    });
    expect(page.goto).toHaveBeenCalledWith("https://example.com/", {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.pageTimeoutMs,
    });
  });

  it("opens its own context and closes it together with the page", async () => {
    const page = createPageWithBody("Welcome to Example");
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    await runAttempt(browser, createTarget(), 1, "12345");

    expect(browser.newContext).toHaveBeenCalledWith(getContextOptions("12345"));
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(browser.contexts[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared context open", async () => {
    const page = createPageWithBody("Welcome to Example");
    const context = createFakeContext(() => page);
    const browser = createFakeBrowser();

    await runAttempt(browser, createTarget(), 1, null, context);

    expect(browser.newContext).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).not.toHaveBeenCalled();
  });

  it("does not fail when closing the page fails", async () => {
    const page = createPageWithBody("Welcome to Example", {
      close: () => Promise.reject(new Error("already closed")),
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const result = await runAttempt(browser, createTarget(), 1, null);

    expect(result.contentSuccess).toBe(true);
  });

  it("reports a failed request that shows a challenge page", async () => {
    const page = createPageWithBody("Access denied", {
      goto: () => Promise.resolve(createResponse(403)),
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const result = await runAttempt(browser, createTarget(), 2, null);

    expect(result).toMatchObject({
      attempt: 2,
      status: 403,
      requestSuccess: false,
      contentSuccess: false,
      challenge: true,
      error: null,
    });
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("reports a failed request without a challenge", async () => {
    const page = createPageWithBody("Service unavailable", {
      goto: () => Promise.resolve(createResponse(503)),
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const result = await runAttempt(browser, createTarget(), 1, null);

    expect(result).toMatchObject({
      status: 503,
      requestSuccess: false,
      contentSuccess: false,
      challenge: false,
    });
  });

  it("reports the navigation error when goto fails", async () => {
    const page = createPageWithBody("", {
      goto: () => Promise.reject(new Error("Timeout 30000ms exceeded.")),
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const result = await runAttempt(browser, createTarget(), 1, null);

    expect(result).toMatchObject({
      status: null,
      requestSuccess: false,
      contentSuccess: false,
      error: "Timeout 30000ms exceeded.",
    });
  });

  it("reports a missing response without an error", async () => {
    const page = createPageWithBody("", { goto: () => Promise.resolve(null) });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const result = await runAttempt(browser, createTarget(), 1, null);

    expect(result).toMatchObject({
      status: null,
      requestSuccess: false,
      error: null,
    });
  });

  it("reports a page that stays on about:blank as a stuck navigation", async () => {
    const page = createPageWithBody("", { url: () => "about:blank" });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const promise = runAttempt(browser, createTarget(), 1, null);

    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toMatchObject({
      status: null,
      requestSuccess: false,
      contentSuccess: false,
      challenge: false,
      finalUrl: "about:blank",
      error: 'Page remained on "about:blank" for 5 seconds.',
    });
    expect(result.responseTime).toBeGreaterThanOrEqual(
      CONFIG.navigationRecoveryTimeoutMs
    );
    expect(console.log).toHaveBeenCalledWith(
      "Navigation did not complete within 5 seconds. Retrying..."
    );
  });

  it("reports an unresolved challenge and saves diagnostics for targets that request them", async () => {
    const page = createPageWithBody("Checking your browser - eBay");
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const promise = runAttempt(browser, EBAY, 3, null);

    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toMatchObject({
      status: 200,
      requestSuccess: true,
      contentSuccess: false,
      challenge: true,
    });
    expect(result.responseTime).toBeGreaterThanOrEqual(
      CONFIG.challengeWaitTimeoutMs
    );
    expect(page.screenshot).toHaveBeenCalledWith({
      path: "ebay-challenge-3.png",
      fullPage: true,
    });
  });

  it("does not save diagnostics when the challenge resolves", async () => {
    const startedAt = Date.now();
    const page = createFakePage({
      body: () =>
        Promise.resolve(
          Date.now() - startedAt < 2_000 ? "Just a moment" : "Welcome to eBay"
        ),
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const promise = runAttempt(browser, EBAY, 1, null);

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      contentSuccess: true,
      challenge: true,
    });
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("leaves the title empty when it cannot be read", async () => {
    const page = createPageWithBody("Welcome to Example", {
      title: () => Promise.reject(new Error("closed")),
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const result = await runAttempt(browser, createTarget(), 1, null);

    expect(result).toMatchObject({
      finalUrl: "https://example.com/",
      title: null,
    });
  });
});

describe("runAttempt with a challenge status", () => {
  it("treats the status as a delivered request and reports a challenge that resolved by itself", async () => {
    const startedAt = Date.now();
    const page = createFakePage({
      goto: () => Promise.resolve(createResponse(498)),
      navigationStatus: () => (Date.now() - startedAt < 2_000 ? 498 : 200),
      body: () =>
        Promise.resolve(
          Date.now() - startedAt < 2_000
            ? "Проверяем браузер"
            : "Интернет-магазин Wildberries"
        ),
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const promise = runAttempt(browser, WILDBERRIES, 1, null);

    await vi.runAllTimersAsync();

    // The reported status is the one of the page that delivered the content.
    await expect(promise).resolves.toMatchObject({
      status: 200,
      requestSuccess: true,
      contentSuccess: true,
      challenge: true,
      error: null,
    });
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("flags the challenge even when the page shows no recognisable challenge text", async () => {
    const startedAt = Date.now();
    const page = createFakePage({
      goto: () => Promise.resolve(createResponse(498)),
      navigationStatus: () => (Date.now() - startedAt < 7_000 ? 498 : 200),
      body: () =>
        Promise.resolve(
          Date.now() - startedAt < 7_000 ? "" : "Интернет-магазин Wildberries"
        ),
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const promise = runAttempt(browser, WILDBERRIES, 1, null);

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      status: 200,
      requestSuccess: true,
      contentSuccess: true,
      challenge: true,
    });
  });

  it("reports an unresolved challenge and saves diagnostics", async () => {
    const page = createPageWithBody(
      "Что-то не так... Подозрительная активность. Пожалуйста, подождите.",
      {
        goto: () => Promise.resolve(createResponse(498)),
        navigationStatus: () => 498,
      }
    );
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const promise = runAttempt(browser, WILDBERRIES, 1, null);

    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toMatchObject({
      status: 498,
      requestSuccess: true,
      contentSuccess: false,
      challenge: true,
    });
    expect(result.responseTime).toBeGreaterThanOrEqual(
      CONFIG.challengeWaitTimeoutMs
    );
    expect(page.screenshot).toHaveBeenCalledWith({
      path: "wildberries-challenge-1.png",
      fullPage: true,
    });
  });

  it("keeps the challenge status when the content never arrives", async () => {
    const page = createPageWithBody("Подозрительная активность", {
      goto: () => Promise.resolve(createResponse(498)),
      navigationStatus: () => 498,
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const promise = runAttempt(browser, WILDBERRIES, 1, null);

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      status: 498,
      contentSuccess: false,
    });
  });

  it("keeps treating the same status as a failed request for a target that does not list it", async () => {
    const page = createPageWithBody("Service error", {
      goto: () => Promise.resolve(createResponse(498)),
    });
    const browser = createFakeBrowser(() => createFakeContext(() => page));

    const result = await runAttempt(browser, createTarget(), 1, null);

    expect(result).toMatchObject({
      status: 498,
      requestSuccess: false,
      contentSuccess: false,
      challenge: false,
    });
  });
});

describe("saveChallengeDiagnostics", () => {
  it("does nothing for targets that do not request diagnostics", async () => {
    const page = createPageWithBody("Access denied");

    await saveChallengeDiagnostics(page, createTarget(), 1);

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("prints the url, title and a whitespace-normalised body preview", async () => {
    const longBody = `line one\n\n   line   two ${"x".repeat(2_000)}`;
    const page = createPageWithBody(longBody, {
      url: () => "https://www.ebay.com/challenge",
      title: () => Promise.resolve("Pardon Our Interruption"),
    });

    await saveChallengeDiagnostics(page, EBAY, 2);

    const lines = loggedLines();
    const preview = lines.find(
      (line): line is string =>
        typeof line === "string" && line.startsWith("Body preview: ")
    );

    expect(lines).toContain("Challenge diagnostics for attempt 2:");
    expect(lines).toContain("Final URL: https://www.ebay.com/challenge");
    expect(lines).toContain("Title: Pardon Our Interruption");
    expect(preview?.startsWith("Body preview: line one line two xxx")).toBe(true);
    expect(preview?.length).toBe("Body preview: ".length + 1_000);
    expect(lines).toContain("Screenshot saved to ebay-challenge-2.png");
  });

  it("reports unavailable details instead of failing", async () => {
    const page = createFakePage({
      url: () => {
        throw new Error("closed");
      },
      title: () => Promise.reject(new Error("closed")),
      body: () => Promise.reject(new Error("closed")),
      screenshot: () => Promise.reject(new Error("no disk space")),
    });

    await saveChallengeDiagnostics(page, EBAY, 1);

    const lines = loggedLines();

    expect(lines).toContain("Final URL: unavailable");
    expect(lines).toContain("Title: unavailable");
    expect(lines).toContain("Body preview: unavailable");
    expect(lines).toContain("Screenshot failed: no disk space");
  });
});

describe("runTarget", () => {
  function createHealthyBrowser() {
    return createFakeBrowser(() =>
      createFakeContext(() => createPageWithBody("Welcome to Example"))
    );
  }

  it("runs the configured number of attempts and returns their results", async () => {
    const browser = createHealthyBrowser();

    const promise = runTarget(browser, createTarget(), null, false);

    await vi.runAllTimersAsync();

    const results = await promise;

    expect(results.map((result) => result.attempt)).toEqual(
      Array.from({ length: CONFIG.attempts }, (_, index) => index + 1)
    );
    expect(results.every((result) => result.contentSuccess)).toBe(true);
  });

  it("prints the target name and every attempt result", async () => {
    const browser = createHealthyBrowser();

    const promise = runTarget(browser, createTarget({ name: "Example" }), null, false);

    await vi.runAllTimersAsync();

    const results = await promise;

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Example")
    );

    for (const result of results) {
      expect(console.log).toHaveBeenCalledWith(formatAttemptResult(result));
    }
  });

  it("pauses between attempts but not after the last one", async () => {
    const browser = createHealthyBrowser();
    const startedAt = Date.now();

    const promise = runTarget(browser, createTarget(), null, false);

    await vi.runAllTimersAsync();
    await promise;

    expect(Date.now() - startedAt).toBe(
      (CONFIG.attempts - 1) * CONFIG.attemptDelayMs
    );
  });

  it("uses a new context per attempt by default", async () => {
    const browser = createHealthyBrowser();

    const promise = runTarget(browser, createTarget(), "12345", false);

    await vi.runAllTimersAsync();
    await promise;

    expect(browser.contexts).toHaveLength(CONFIG.attempts);
    expect(
      browser.contexts.every((context) => context.close.mock.calls.length === 1)
    ).toBe(true);
  });

  it("shares and finally closes a single context when it is reused", async () => {
    const browser = createHealthyBrowser();

    const promise = runTarget(browser, createTarget(), "12345", true);

    await vi.runAllTimersAsync();
    await promise;

    expect(browser.newContext).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledWith(getContextOptions("12345"));
    expect(browser.contexts[0]?.pages).toHaveLength(CONFIG.attempts);
    expect(browser.contexts[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("does not fail when the shared context cannot be closed", async () => {
    const context = createFakeContext(() => createPageWithBody("Example"));

    context.close.mockRejectedValue(new Error("already closed"));

    const browser = createFakeBrowser(() => context);
    const promise = runTarget(browser, createTarget(), null, true);

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toHaveLength(CONFIG.attempts);
  });

  it("fails when every attempt stays on about:blank", async () => {
    const context = createFakeContext(() =>
      createPageWithBody("", { url: () => "about:blank" })
    );
    const browser = createFakeBrowser(() => context);

    const promise = runTarget(browser, createTarget({ name: "Walmart" }), null, true);
    const assertion = expect(promise).rejects.toThrow(
      "Walmart navigation failed 10 consecutive times. " +
        "The browser remained on about:* instead of navigating to the target."
    );

    await vi.runAllTimersAsync();
    await assertion;

    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("keeps going when only some attempts stay on about:blank", async () => {
    let pagesCreated = 0;
    const browser = createFakeBrowser(() =>
      createFakeContext(() => {
        pagesCreated += 1;

        return createPageWithBody("Welcome to Example", {
          url: () =>
            pagesCreated === 1 ? "about:blank" : "https://example.com/",
        });
      })
    );

    const promise = runTarget(browser, createTarget(), null, false);

    await vi.runAllTimersAsync();

    const results = await promise;

    expect(results).toHaveLength(CONFIG.attempts);
    expect(results[0]?.error).toContain("Page remained on");
    expect(results[1]?.contentSuccess).toBe(true);
  });
});
