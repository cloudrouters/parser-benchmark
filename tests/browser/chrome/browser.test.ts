import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  createChromeBrowser,
  type CdpBrowser,
  type CdpSession,
  type ChromeBrowserDeps,
} from "../../../src/browser/chrome/browser.js";
import type { ChromeProcess } from "../../../src/browser/chrome/process.js";
import type { PageLike } from "../../../src/browser/types.js";
import { getContextOptions } from "../../../src/browser/context.js";
import { CONFIG } from "../../../src/shared/config.js";
import { createFakePage, type FakePage } from "../../helpers/fakes.js";

interface FakeChromeProcess extends ChromeProcess {
  waitForExit: Mock<ChromeProcess["waitForExit"]>;
  forceKill: Mock<ChromeProcess["forceKill"]>;
  removeProfile: Mock<ChromeProcess["removeProfile"]>;
}

function createFakeProcess(exitsGracefully = true): FakeChromeProcess {
  return {
    endpoint: "http://127.0.0.1:9222",
    waitForExit: vi.fn<ChromeProcess["waitForExit"]>(() =>
      Promise.resolve(exitsGracefully)
    ),
    forceKill: vi.fn<ChromeProcess["forceKill"]>(() => Promise.resolve()),
    removeProfile: vi.fn<ChromeProcess["removeProfile"]>(() => Promise.resolve()),
  };
}

interface FakeCdp {
  browser: CdpBrowser;
  send: Mock<CdpSession["send"]>;
  newPage: Mock<() => Promise<PageLike>>;
  close: Mock<CdpBrowser["close"]>;
  initialTab: FakePage | null;
}

function createFakeCdp(initialTab: FakePage | null = createFakePage()): FakeCdp {
  const send = vi.fn<CdpSession["send"]>(() => Promise.resolve({}));
  const newPage = vi.fn<() => Promise<PageLike>>(() =>
    Promise.resolve(createFakePage())
  );
  const close = vi.fn<CdpBrowser["close"]>(() => Promise.resolve());

  return {
    send,
    newPage,
    close,
    initialTab,
    browser: {
      contexts: () => [
        {
          pages: () => (initialTab === null ? [] : [initialTab]),
          newPage,
        },
      ],
      newBrowserCDPSession: () => Promise.resolve({ send }),
      close,
    },
  };
}

interface Harness {
  deps: ChromeBrowserDeps;
  chromeProcess: FakeChromeProcess;
  cdp: FakeCdp;
  startProcess: Mock<ChromeBrowserDeps["startProcess"]>;
  connect: Mock<ChromeBrowserDeps["connect"]>;
}

function createHarness(
  options: { chromeProcess?: FakeChromeProcess; cdp?: FakeCdp } = {}
): Harness {
  const chromeProcess = options.chromeProcess ?? createFakeProcess();
  const cdp = options.cdp ?? createFakeCdp();
  const startProcess = vi.fn<ChromeBrowserDeps["startProcess"]>(() =>
    Promise.resolve(chromeProcess)
  );
  const connect = vi.fn<ChromeBrowserDeps["connect"]>(() =>
    Promise.resolve(cdp.browser)
  );

  return {
    chromeProcess,
    cdp,
    startProcess,
    connect,
    deps: { startProcess, connect },
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createChromeBrowser", () => {
  it("starts Chrome without a proxy in direct mode", async () => {
    const harness = createHarness();

    await createChromeBrowser(harness.deps).newContext(getContextOptions(null));

    expect(harness.startProcess).toHaveBeenCalledWith({ proxyServer: null });
  });

  it("starts Chrome through the local proxy bridge in SOCKS5 mode", async () => {
    const harness = createHarness();

    await createChromeBrowser(harness.deps).newContext(getContextOptions("12345"));

    expect(harness.startProcess).toHaveBeenCalledWith({
      proxyServer: "http://127.0.0.1:12345",
    });
  });

  it("connects to the DevTools endpoint of the started process", async () => {
    const harness = createHarness();

    await createChromeBrowser(harness.deps).newContext(getContextOptions(null));

    expect(harness.connect).toHaveBeenCalledWith("http://127.0.0.1:9222");
  });

  it("starts a separate Chrome for every context", async () => {
    const harness = createHarness();
    const browser = createChromeBrowser(harness.deps);

    await browser.newContext(getContextOptions(null));
    await browser.newContext(getContextOptions(null));

    expect(harness.startProcess).toHaveBeenCalledTimes(2);
  });

  it("drives the initial tab so that no blank tab precedes the target", async () => {
    const harness = createHarness();
    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    const page = await context.newPage();

    await page.goto("https://www.wildberries.ru/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    expect(harness.cdp.initialTab?.goto).toHaveBeenCalledWith(
      "https://www.wildberries.ru/",
      { waitUntil: "domcontentloaded", timeout: 30_000 }
    );
    expect(harness.cdp.newPage).not.toHaveBeenCalled();
  });

  it("exposes the state of the initial tab", async () => {
    const tab = createFakePage({
      url: () => "https://www.wildberries.ru/",
      title: () => Promise.resolve("Wildberries"),
      body: () => Promise.resolve("catalog"),
      navigationStatus: () => 200,
    });
    const harness = createHarness({ cdp: createFakeCdp(tab) });
    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    const page = await context.newPage();

    expect(page.url()).toBe("https://www.wildberries.ru/");
    await expect(page.title()).resolves.toBe("Wildberries");
    await expect(page.locator("body").innerText({ timeout: 1 })).resolves.toBe(
      "catalog"
    );
    await expect(page.evaluate("1")).resolves.toBe(200);
  });

  it("takes screenshots of the initial tab", async () => {
    const harness = createHarness();
    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    const page = await context.newPage();

    await page.screenshot({ path: "shot.png", fullPage: true });

    expect(harness.cdp.initialTab?.screenshot).toHaveBeenCalledWith({
      path: "shot.png",
      fullPage: true,
    });
  });

  it("resets the only tab to a blank page instead of closing it so Chrome stays alive", async () => {
    const harness = createHarness();
    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    const page = await context.newPage();

    await page.close();

    expect(harness.cdp.initialTab?.close).not.toHaveBeenCalled();
    expect(harness.cdp.initialTab?.goto).toHaveBeenCalledWith("about:blank", {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.pageTimeoutMs,
    });
  });

  it("reuses the same tab for the next page of a reused context", async () => {
    const harness = createHarness();
    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    const first = await context.newPage();

    await first.close();

    const second = await context.newPage();

    await second.goto("https://www.wildberries.ru/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    expect(harness.cdp.newPage).not.toHaveBeenCalled();
    expect(harness.cdp.initialTab?.goto).toHaveBeenLastCalledWith(
      "https://www.wildberries.ru/",
      { waitUntil: "domcontentloaded", timeout: 30_000 }
    );
  });

  it("opens a tab itself when Chrome starts without one", async () => {
    const harness = createHarness({ cdp: createFakeCdp(null) });
    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    await context.newPage();

    expect(harness.cdp.newPage).toHaveBeenCalledTimes(1);
  });

  it("closes the whole Chrome: asks it to quit, waits, disconnects and removes the profile", async () => {
    const harness = createHarness();
    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    await context.close();

    expect(harness.cdp.send).toHaveBeenCalledWith("Browser.close");
    expect(harness.chromeProcess.waitForExit).toHaveBeenCalledWith(
      CONFIG.chromeShutdownTimeoutMs
    );
    expect(harness.chromeProcess.forceKill).not.toHaveBeenCalled();
    expect(harness.cdp.close).toHaveBeenCalledTimes(1);
    expect(harness.chromeProcess.removeProfile).toHaveBeenCalledTimes(1);
  });

  it("kills Chrome when it does not quit in time", async () => {
    const harness = createHarness({ chromeProcess: createFakeProcess(false) });
    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    await context.close();

    expect(harness.chromeProcess.forceKill).toHaveBeenCalledTimes(1);
    expect(harness.chromeProcess.removeProfile).toHaveBeenCalledTimes(1);
  });

  it("kills Chrome when the quit request fails", async () => {
    const harness = createHarness();

    harness.cdp.send.mockRejectedValue(new Error("connection closed"));

    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    await context.close();

    expect(harness.chromeProcess.waitForExit).not.toHaveBeenCalled();
    expect(harness.chromeProcess.forceKill).toHaveBeenCalledTimes(1);
    expect(harness.chromeProcess.removeProfile).toHaveBeenCalledTimes(1);
  });

  it("warns instead of failing when the profile cannot be removed", async () => {
    const harness = createHarness();

    harness.chromeProcess.removeProfile.mockRejectedValue(new Error("EBUSY"));

    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    await expect(context.close()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      "Could not remove the temporary Chrome profile: EBUSY"
    );
  });

  it("warns instead of failing when Chrome cannot be killed", async () => {
    const harness = createHarness({ chromeProcess: createFakeProcess(false) });

    harness.chromeProcess.forceKill.mockRejectedValue(new Error("denied"));

    const context = await createChromeBrowser(harness.deps).newContext(
      getContextOptions(null)
    );

    await expect(context.close()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      "Could not stop Chrome (the profile is left on disk): denied"
    );
    expect(harness.chromeProcess.removeProfile).not.toHaveBeenCalled();
  });

  it("stops Chrome and rethrows when connecting to it fails", async () => {
    const harness = createHarness();

    harness.connect.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(
      createChromeBrowser(harness.deps).newContext(getContextOptions(null))
    ).rejects.toThrow("connect ECONNREFUSED");
    expect(harness.chromeProcess.forceKill).toHaveBeenCalledTimes(1);
    expect(harness.chromeProcess.removeProfile).toHaveBeenCalledTimes(1);
  });

  it("stops Chrome and fails when it has no default browser context", async () => {
    const harness = createHarness();
    const noContexts: CdpBrowser = { ...harness.cdp.browser, contexts: () => [] };

    harness.connect.mockResolvedValue(noContexts);

    await expect(
      createChromeBrowser(harness.deps).newContext(getContextOptions(null))
    ).rejects.toThrow("Chrome did not provide a default browser context.");
    expect(harness.chromeProcess.removeProfile).toHaveBeenCalledTimes(1);
  });

  it("lets the browser be closed without owning any process itself", async () => {
    const harness = createHarness();

    await expect(createChromeBrowser(harness.deps).close()).resolves.toBeUndefined();
    expect(harness.startProcess).not.toHaveBeenCalled();
  });
});
