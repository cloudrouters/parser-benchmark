import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  containsChallenge,
  containsExpectedContent,
  getPageText,
  isRealHttpUrl,
  isSuccessfulStatus,
  waitForExpectedContent,
  waitForRealNavigation,
} from "../../src/checks/page-checks.js";
import { CONFIG } from "../../src/shared/config.js";
import { createFakePage } from "../helpers/fakes.js";

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

    await expect(getPageText(page)).resolves.toBe("my title\nbody text");
  });

  it("falls back to the body when the title cannot be read", async () => {
    const page = createFakePage({
      title: () => Promise.reject(new Error("closed")),
      body: () => Promise.resolve("Body"),
    });

    await expect(getPageText(page)).resolves.toBe("\nbody");
  });

  it("falls back to the title when the body cannot be read", async () => {
    const page = createFakePage({
      title: () => Promise.resolve("Title"),
      body: () => Promise.reject(new Error("timeout")),
    });

    await expect(getPageText(page)).resolves.toBe("title\n");
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

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      "Challenge detected. Waiting up to 30 seconds for automatic resolution..."
    );
  });
});
