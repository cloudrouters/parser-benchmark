import { writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ProfilesModule from "../src/browser/profiles.js";
import { launchBrowser } from "../src/browser/profiles.js";
import { main } from "../src/main.js";
import {
  startProxyBridge,
  stopProxyBridge,
} from "../src/proxy/proxy-bridge.js";
import { CONFIG } from "../src/shared/config.js";
import {
  createFakeBrowser,
  createFakeContext,
  createFakePage,
  createResponse,
  type FakeBrowser,
  type FakePage,
} from "./helpers/fakes.js";

vi.mock("../src/browser/profiles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ProfilesModule>();

  return { ...actual, launchBrowser: vi.fn() };
});

vi.mock("../src/proxy/proxy-bridge.js", () => ({
  startProxyBridge: vi.fn(),
  stopProxyBridge: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ writeFile: vi.fn() }));

const ALL_TARGET_CONTENT =
  "Google Bing Amazon eBay Walmart Booking.com LinkedIn";

const SOCKS5_URL = "socks5://login:secret@1.2.3.4:1080";

interface PageBehavior {
  /** HTTP status returned by the IP check service. */
  ipStatus?: number;
  /** URL the browser reports after navigating to a target (default: the target URL). */
  reportedTargetUrl?: string;
}

function createBenchmarkPage({
  ipStatus = 200,
  reportedTargetUrl,
}: PageBehavior = {}): FakePage {
  let currentUrl = "about:blank";

  return createFakePage({
    goto: (url) => {
      const isIpCheck = url === CONFIG.ipCheckUrl;

      currentUrl = isIpCheck ? url : (reportedTargetUrl ?? url);

      return Promise.resolve(createResponse(isIpCheck ? ipStatus : 200));
    },
    url: () => currentUrl,
    body: () =>
      Promise.resolve(
        currentUrl === CONFIG.ipCheckUrl
          ? '{"ip":"1.2.3.4"}'
          : ALL_TARGET_CONTENT
      ),
  });
}

function createBenchmarkBrowser(behavior: PageBehavior = {}): FakeBrowser {
  const browser = createFakeBrowser(() =>
    createFakeContext(() => createBenchmarkPage(behavior))
  );

  vi.mocked(launchBrowser).mockResolvedValue(browser);

  return browser;
}

async function runMain(argv: readonly string[]): Promise<void> {
  const promise = main(argv);

  await vi.runAllTimersAsync();
  await promise;
}

function loggedLines(spy: typeof console.log): unknown[] {
  return vi.mocked(spy).mock.calls.map((call): unknown => call[0]);
}

function savedOutput(): { path: unknown; raw: string; parsed: unknown } {
  const call = vi.mocked(writeFile).mock.calls[0];
  const content = call?.[1];

  if (typeof content !== "string") {
    throw new Error("The output file was not written as a string.");
  }

  return { path: call?.[0], raw: content, parsed: JSON.parse(content) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.mocked(stopProxyBridge).mockResolvedValue(undefined);
});

afterEach(() => {
  process.exitCode = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("main", () => {
  it("runs a direct benchmark and saves the results", async () => {
    const browser = createBenchmarkBrowser();

    await runMain([]);

    expect(startProxyBridge).not.toHaveBeenCalled();
    expect(launchBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ name: "chromium" })
    );
    expect(writeFile).toHaveBeenCalledTimes(1);

    const output = savedOutput();

    expect(output.path).toBe(CONFIG.outputFile);
    expect(vi.mocked(writeFile).mock.calls[0]?.[2]).toBe("utf8");
    expect(output.parsed).toMatchObject({
      mode: "DIRECT",
      proxy: null,
      externalIP: "1.2.3.4",
      attempts: CONFIG.attempts,
      contextMode: "NEW_PER_ATTEMPT",
      browser: "chromium",
      targetSet: "global",
    });
    expect(output.parsed).toHaveProperty("targets.length", 7);
    expect(process.exitCode).toBeUndefined();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(stopProxyBridge).toHaveBeenCalledWith(null);
    expect(loggedLines(console.log)).toContain(
      `Results saved to ${CONFIG.outputFile}`
    );
  });

  it("routes the browser through the proxy bridge and masks the password", async () => {
    const bridge = { url: "http://127.0.0.1:12345", port: "12345" };

    vi.mocked(startProxyBridge).mockResolvedValue(bridge);

    const browser = createBenchmarkBrowser();

    await runMain([SOCKS5_URL, "--reuse-context"]);

    expect(startProxyBridge).toHaveBeenCalledWith(SOCKS5_URL);
    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ proxy: { server: "http://127.0.0.1:12345" } })
    );

    const output = savedOutput();

    expect(output.raw).not.toContain("secret");
    expect(output.parsed).toMatchObject({
      mode: "SOCKS5",
      proxy: "socks5://login:***@1.2.3.4:1080",
      contextMode: "REUSED",
    });
    expect(stopProxyBridge).toHaveBeenCalledWith(bridge);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("launches the browser selected with --browser", async () => {
    createBenchmarkBrowser();

    await runMain(["--browser=chrome"]);

    expect(launchBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ name: "chrome" })
    );
    expect(savedOutput().parsed).toMatchObject({ browser: "chrome" });
  });

  it("stops without saving results when the internet check fails and keeps the exit code", async () => {
    const browser = createBenchmarkBrowser({ ipStatus: 500 });

    await runMain([]);

    expect(loggedLines(console.log)).toContain("Benchmark stopped.");
    expect(writeFile).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(stopProxyBridge).toHaveBeenCalledWith(null);
  });

  it("reports a failure, sets the exit code and still cleans up", async () => {
    const bridge = { url: "http://127.0.0.1:12345", port: "12345" };

    vi.mocked(startProxyBridge).mockResolvedValue(bridge);

    const browser = createBenchmarkBrowser({ reportedTargetUrl: "about:blank" });

    await runMain([SOCKS5_URL]);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith("Benchmark failed:");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("navigation failed 10 consecutive times")
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(stopProxyBridge).toHaveBeenCalledWith(bridge);
  });

  it.each([
    ["an invalid proxy url", ["http://login:secret@1.2.3.4:8080"]],
    ["an unknown flag", ["--unknown-flag"]],
    ["an unknown browser", ["--browser=netscape"]],
    ["an unknown target set", ["--targets=mars"]],
  ])("fails before launching a browser for %s", async (_description, argv) => {
    await runMain(argv);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith("Benchmark failed:");
    expect(launchBrowser).not.toHaveBeenCalled();
    expect(startProxyBridge).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
