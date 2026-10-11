import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkInternet,
  parseIpifyResponse,
} from "../../src/checks/ip-check.js";
import { CONFIG } from "../../src/shared/config.js";
import {
  createFakeBrowser,
  createFakeContext,
  createFakePage,
  createResponse,
  type FakePageOptions,
} from "../helpers/fakes.js";

describe("parseIpifyResponse", () => {
  it("returns the ip address from a valid response", () => {
    expect(parseIpifyResponse({ ip: "188.28.90.112" })).toEqual({
      ip: "188.28.90.112",
    });
  });

  it("trims whitespace around the ip address", () => {
    expect(parseIpifyResponse({ ip: " 1.2.3.4 \n" })).toEqual({ ip: "1.2.3.4" });
  });

  it.each([
    ["null", null],
    ["a string", "1.2.3.4"],
    ["an object without ip", {}],
    ["a non-string ip", { ip: 1234 }],
    ["an empty ip", { ip: "" }],
    ["a blank ip", { ip: "   " }],
  ])("throws when the response is %s", (_description, value) => {
    expect(() => parseIpifyResponse(value)).toThrow(
      "IP address was not found in response."
    );
  });
});

describe("checkInternet", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createBrowserWithPage(options: FakePageOptions) {
    const page = createFakePage(options);
    const context = createFakeContext(() => page);
    const browser = createFakeBrowser(() => context);

    return { browser, context, page };
  }

  it("returns the external ip and closes the context", async () => {
    const { browser, context, page } = createBrowserWithPage({
      body: () => Promise.resolve('{"ip":"1.2.3.4"}'),
    });

    await expect(checkInternet(browser, null)).resolves.toBe("1.2.3.4");

    expect(page.goto).toHaveBeenCalledWith(CONFIG.ipCheckUrl, {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.internetCheckTimeoutMs,
    });
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("routes the browser context through the local proxy port", async () => {
    const { browser } = createBrowserWithPage({
      body: () => Promise.resolve('{"ip":"1.2.3.4"}'),
    });

    await checkInternet(browser, "12345");

    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ proxy: { server: "http://127.0.0.1:12345" } })
    );
  });

  it.each([
    [
      "the response is empty",
      { goto: () => Promise.resolve(null) },
      "IP check returned no response.",
    ],
    [
      "the HTTP status is not successful",
      { goto: () => Promise.resolve(createResponse(500)) },
      "IP check returned HTTP 500.",
    ],
    [
      "the body is not JSON",
      { body: () => Promise.resolve("<html></html>") },
      "IP check returned invalid JSON.",
    ],
    [
      "the JSON has no ip",
      { body: () => Promise.resolve("{}") },
      "IP address was not found in response.",
    ],
    [
      "the navigation fails",
      { goto: () => Promise.reject(new Error("net::ERR_PROXY_CONNECTION_FAILED")) },
      "net::ERR_PROXY_CONNECTION_FAILED",
    ],
  ] satisfies [string, FakePageOptions, string][])(
    "returns null and reports the reason when %s",
    async (_description, options, reason) => {
      const { browser, context } = createBrowserWithPage({
        body: () => Promise.resolve('{"ip":"1.2.3.4"}'),
        ...options,
      });

      await expect(checkInternet(browser, null)).resolves.toBeNull();

      expect(console.error).toHaveBeenCalledWith(`Reason: ${reason}`);
      expect(context.close).toHaveBeenCalledTimes(1);
    }
  );
});
