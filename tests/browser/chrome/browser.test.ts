import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  createChromeBrowser,
  type CdpBrowser,
  type CdpPage,
  type CdpSession,
  type ChromeBrowserDeps,
} from "../../../src/browser/chrome/browser.js";
import type {
  ChromeProcess,
  ChromeProfile,
} from "../../../src/browser/chrome/process.js";
import { getContextOptions } from "../../../src/browser/context.js";
import { CONFIG } from "../../../src/shared/config.js";
import { createFakePage, type FakePage } from "../../helpers/fakes.js";

const PROFILE_DIRECTORY = "/tmp/parser-benchmark-chrome-test";

interface FakeProfile extends ChromeProfile {
  remove: Mock<ChromeProfile["remove"]>;
}

function createFakeProfile(directory = PROFILE_DIRECTORY): FakeProfile {
  return {
    directory,
    remove: vi.fn<ChromeProfile["remove"]>(() => Promise.resolve()),
  };
}

interface FakeChromeProcess extends ChromeProcess {
  waitForExit: Mock<ChromeProcess["waitForExit"]>;
  forceKill: Mock<ChromeProcess["forceKill"]>;
}

function createFakeProcess(exitsGracefully = true): FakeChromeProcess {
  return {
    endpoint: "http://127.0.0.1:9222",
    waitForExit: vi.fn<ChromeProcess["waitForExit"]>(() =>
      Promise.resolve(exitsGracefully)
    ),
    forceKill: vi.fn<ChromeProcess["forceKill"]>(() => Promise.resolve()),
  };
}

type ConsoleListener = (message: { text(): string }) => void;

interface FakeTab extends CdpPage {
  addInitScript: Mock<CdpPage["addInitScript"]>;
  /** Plays a message of the page console, as Chrome reports it. */
  emitConsole(text: string): void;
  fake: FakePage;
}

function createFakeTab(fake: FakePage = createFakePage()): FakeTab {
  const listeners: ConsoleListener[] = [];

  return {
    ...fake,
    fake,
    // The page methods are spied on the fake, so delegate to it.
    goto: (url, options) => fake.goto(url, options),
    screenshot: (options) => fake.screenshot(options),
    close: () => fake.close(),
    addInitScript: vi.fn<CdpPage["addInitScript"]>(() => Promise.resolve()),
    on: (_event, listener) => {
      listeners.push(listener);
    },
    emitConsole: (text) => {
      for (const listener of listeners) {
        listener({ text: () => text });
      }
    },
  };
}

interface FakeCdp {
  browser: CdpBrowser;
  send: Mock<CdpSession["send"]>;
  newPage: Mock<() => Promise<CdpPage>>;
  close: Mock<CdpBrowser["close"]>;
  initialTab: FakeTab | null;
}

function createFakeCdp(initialTab: FakeTab | null = createFakeTab()): FakeCdp {
  const send = vi.fn<CdpSession["send"]>(() => Promise.resolve({}));
  const newPage = vi.fn<() => Promise<CdpPage>>(() =>
    Promise.resolve(createFakeTab())
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
  profile: FakeProfile;
  chromeProcess: FakeChromeProcess;
  cdp: FakeCdp;
  createProfile: Mock<ChromeBrowserDeps["createProfile"]>;
  startProcess: Mock<ChromeBrowserDeps["startProcess"]>;
  connect: Mock<ChromeBrowserDeps["connect"]>;
}

function createHarness(
  options: { chromeProcess?: FakeChromeProcess; cdp?: FakeCdp } = {}
): Harness {
  const profile = createFakeProfile();
  const chromeProcess = options.chromeProcess ?? createFakeProcess();
  const cdp = options.cdp ?? createFakeCdp();
  const createProfile = vi.fn<ChromeBrowserDeps["createProfile"]>(() =>
    Promise.resolve(profile)
  );
  const startProcess = vi.fn<ChromeBrowserDeps["startProcess"]>(() =>
    Promise.resolve(chromeProcess)
  );
  const connect = vi.fn<ChromeBrowserDeps["connect"]>(() =>
    Promise.resolve(cdp.browser)
  );

  return {
    profile,
    chromeProcess,
    cdp,
    createProfile,
    startProcess,
    connect,
    deps: { createProfile, startProcess, connect },
  };
}

async function openContext(harness: Harness, localPort: string | null = null) {
  return createChromeBrowser(harness.deps).newContext(
    getContextOptions(localPort)
  );
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createChromeBrowser contexts and profiles", () => {
  it("creates the profile of a context without starting Chrome yet", async () => {
    const harness = createHarness();

    await openContext(harness);

    expect(harness.createProfile).toHaveBeenCalledTimes(1);
    expect(harness.startProcess).not.toHaveBeenCalled();
  });

  it("gives every context a profile of its own", async () => {
    const harness = createHarness();
    const browser = createChromeBrowser(harness.deps);

    await browser.newContext(getContextOptions(null));
    await browser.newContext(getContextOptions(null));

    expect(harness.createProfile).toHaveBeenCalledTimes(2);
  });

  it("starts Chrome on the profile without a proxy in direct mode", async () => {
    const harness = createHarness();
    const context = await openContext(harness);

    await context.newPage();

    expect(harness.startProcess).toHaveBeenCalledWith({
      proxyServer: null,
      userDataDir: PROFILE_DIRECTORY,
    });
  });

  it("starts Chrome through the local proxy bridge in SOCKS5 mode", async () => {
    const harness = createHarness();
    const context = await openContext(harness, "12345");

    await context.newPage();

    expect(harness.startProcess).toHaveBeenCalledWith({
      proxyServer: "http://127.0.0.1:12345",
      userDataDir: PROFILE_DIRECTORY,
    });
  });

  it("connects to the DevTools endpoint of the started process", async () => {
    const harness = createHarness();
    const context = await openContext(harness);

    await context.newPage();

    expect(harness.connect).toHaveBeenCalledWith("http://127.0.0.1:9222");
  });

  it("lets the browser be closed without owning any process itself", async () => {
    const harness = createHarness();

    await expect(createChromeBrowser(harness.deps).close()).resolves.toBeUndefined();
    expect(harness.startProcess).not.toHaveBeenCalled();
  });
});

/*
 * With a reused context every attempt must be a new Chrome on the same
 * profile: the website sees the stored cookies of the previous attempt, but
 * a restarted browser. Resetting only the tab is not enough.
 */
describe("createChromeBrowser page lifecycle", () => {
  it("starts a new Chrome on the same profile for every page of a context", async () => {
    const harness = createHarness();
    const context = await openContext(harness);

    const first = await context.newPage();

    await first.close();

    const second = await context.newPage();

    await second.close();

    expect(harness.createProfile).toHaveBeenCalledTimes(1);
    expect(harness.startProcess).toHaveBeenCalledTimes(2);
    expect(harness.startProcess).toHaveBeenNthCalledWith(1, {
      proxyServer: null,
      userDataDir: PROFILE_DIRECTORY,
    });
    expect(harness.startProcess).toHaveBeenNthCalledWith(2, {
      proxyServer: null,
      userDataDir: PROFILE_DIRECTORY,
    });
  });

  it("quits the whole Chrome when its page is closed: asks it to quit, waits and disconnects", async () => {
    const harness = createHarness();
    const context = await openContext(harness);
    const page = await context.newPage();

    await page.close();

    expect(harness.cdp.send).toHaveBeenCalledWith("Browser.close");
    expect(harness.chromeProcess.waitForExit).toHaveBeenCalledWith(
      CONFIG.chromeShutdownTimeoutMs
    );
    expect(harness.chromeProcess.forceKill).not.toHaveBeenCalled();
    expect(harness.cdp.close).toHaveBeenCalledTimes(1);
  });

  it("does not close the tab itself, it quits Chrome instead", async () => {
    const harness = createHarness();
    const context = await openContext(harness);
    const page = await context.newPage();

    await page.close();

    expect(harness.cdp.initialTab?.fake.close).not.toHaveBeenCalled();
    expect(harness.cdp.initialTab?.fake.goto).not.toHaveBeenCalled();
  });

  it("keeps the profile when a page is closed so that its storage survives", async () => {
    const harness = createHarness();
    const context = await openContext(harness);
    const page = await context.newPage();

    await page.close();

    expect(harness.profile.remove).not.toHaveBeenCalled();
  });

  it("quits Chrome only once when a page is closed twice", async () => {
    const harness = createHarness();
    const context = await openContext(harness);
    const page = await context.newPage();

    await page.close();
    await page.close();

    expect(harness.cdp.send).toHaveBeenCalledTimes(1);
  });

  it("refuses a second page while the first Chrome of the context is running", async () => {
    const harness = createHarness();
    const context = await openContext(harness);

    await context.newPage();

    await expect(context.newPage()).rejects.toThrow(
      "A Chrome page is already open in this context."
    );
    expect(harness.startProcess).toHaveBeenCalledTimes(1);
  });

  it("removes the profile when the context is closed after its page", async () => {
    const harness = createHarness();
    const context = await openContext(harness);
    const page = await context.newPage();

    await page.close();
    await context.close();

    expect(harness.profile.remove).toHaveBeenCalledTimes(1);
    // The Chrome of the page was already quit; nothing is left to stop.
    expect(harness.cdp.send).toHaveBeenCalledTimes(1);
  });

  it("quits a Chrome that is still running before the profile is removed", async () => {
    const harness = createHarness();
    const order: string[] = [];

    harness.cdp.send.mockImplementation(() => {
      order.push("quit");

      return Promise.resolve({});
    });
    harness.profile.remove.mockImplementation(() => {
      order.push("remove");

      return Promise.resolve();
    });

    const context = await openContext(harness);

    await context.newPage();
    await context.close();

    expect(order).toEqual(["quit", "remove"]);
  });

  it("removes the profile of a context that never started Chrome", async () => {
    const harness = createHarness();
    const context = await openContext(harness);

    await context.close();

    expect(harness.cdp.send).not.toHaveBeenCalled();
    expect(harness.profile.remove).toHaveBeenCalledTimes(1);
  });

  it("allows a new page after the previous one was closed even when it was quit by force", async () => {
    const harness = createHarness({ chromeProcess: createFakeProcess(false) });
    const context = await openContext(harness);
    const first = await context.newPage();

    await first.close();

    await expect(context.newPage()).resolves.toBeDefined();
    expect(harness.chromeProcess.forceKill).toHaveBeenCalledTimes(1);
  });
});

describe("createChromeBrowser shutdown failures", () => {
  it("kills Chrome when it does not quit in time", async () => {
    const harness = createHarness({ chromeProcess: createFakeProcess(false) });
    const context = await openContext(harness);
    const page = await context.newPage();

    await page.close();

    expect(harness.chromeProcess.forceKill).toHaveBeenCalledTimes(1);
  });

  it("kills Chrome when the quit request fails", async () => {
    const harness = createHarness();

    harness.cdp.send.mockRejectedValue(new Error("connection closed"));

    const context = await openContext(harness);
    const page = await context.newPage();

    await page.close();

    expect(harness.chromeProcess.waitForExit).not.toHaveBeenCalled();
    expect(harness.chromeProcess.forceKill).toHaveBeenCalledTimes(1);
  });

  it("warns instead of failing when the profile cannot be removed", async () => {
    const harness = createHarness();

    harness.profile.remove.mockRejectedValue(new Error("EBUSY"));

    const context = await openContext(harness);

    await expect(context.close()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      "Could not remove the temporary Chrome profile: EBUSY"
    );
  });

  it("warns instead of failing when Chrome cannot be killed", async () => {
    const harness = createHarness({ chromeProcess: createFakeProcess(false) });

    harness.chromeProcess.forceKill.mockRejectedValue(new Error("denied"));

    const context = await openContext(harness);
    const page = await context.newPage();

    await expect(page.close()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith("Could not stop Chrome: denied");
  });

  it("leaves the profile on disk and says where when Chrome cannot be stopped", async () => {
    const harness = createHarness({ chromeProcess: createFakeProcess(false) });

    harness.chromeProcess.forceKill.mockRejectedValue(new Error("denied"));

    const context = await openContext(harness);

    await context.newPage();
    await context.close();

    expect(harness.profile.remove).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      `The temporary Chrome profile is left on disk: ${PROFILE_DIRECTORY}`
    );
  });
});

describe("createChromeBrowser start failures", () => {
  it("stops Chrome and rethrows when connecting to it fails", async () => {
    const harness = createHarness();

    harness.connect.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const context = await openContext(harness);

    await expect(context.newPage()).rejects.toThrow("connect ECONNREFUSED");
    expect(harness.chromeProcess.forceKill).toHaveBeenCalledTimes(1);
  });

  it("keeps the profile after a failed start so that the context can retry", async () => {
    const harness = createHarness();

    harness.connect.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const context = await openContext(harness);

    await expect(context.newPage()).rejects.toThrow("connect ECONNREFUSED");
    expect(harness.profile.remove).not.toHaveBeenCalled();
    await expect(context.newPage()).resolves.toBeDefined();
  });

  it("stops Chrome and fails when it has no default browser context", async () => {
    const harness = createHarness();
    const noContexts: CdpBrowser = { ...harness.cdp.browser, contexts: () => [] };

    harness.connect.mockResolvedValue(noContexts);

    const context = await openContext(harness);

    await expect(context.newPage()).rejects.toThrow(
      "Chrome did not provide a default browser context."
    );
    // The Chrome that was started is quit, it must not stay open.
    expect(harness.cdp.send).toHaveBeenCalledWith("Browser.close");
  });

  it("does not leave a Chrome running when the start process itself fails", async () => {
    const harness = createHarness();

    harness.startProcess.mockRejectedValue(new Error("Chrome was not found"));

    const context = await openContext(harness);

    await expect(context.newPage()).rejects.toThrow("Chrome was not found");
    await expect(context.close()).resolves.toBeUndefined();
    expect(harness.profile.remove).toHaveBeenCalledTimes(1);
  });
});

describe("createChromeBrowser page", () => {
  it("drives the initial tab so that no blank tab precedes the target", async () => {
    const harness = createHarness();
    const context = await openContext(harness);
    const page = await context.newPage();

    await page.goto("https://www.wildberries.ru/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    expect(harness.cdp.initialTab?.fake.goto).toHaveBeenCalledWith(
      "https://www.wildberries.ru/",
      { waitUntil: "domcontentloaded", timeout: 30_000 }
    );
    expect(harness.cdp.newPage).not.toHaveBeenCalled();
  });

  it("exposes the state of the initial tab", async () => {
    const tab = createFakeTab(
      createFakePage({
        url: () => "https://www.wildberries.ru/",
        title: () => Promise.resolve("Wildberries"),
        body: () => Promise.resolve("catalog"),
        navigationStatus: () => 200,
      })
    );
    const harness = createHarness({ cdp: createFakeCdp(tab) });
    const context = await openContext(harness);

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
    const context = await openContext(harness);
    const page = await context.newPage();

    await page.screenshot({ path: "shot.png", fullPage: true });

    expect(harness.cdp.initialTab?.fake.screenshot).toHaveBeenCalledWith({
      path: "shot.png",
      fullPage: true,
    });
  });

  it("opens a tab itself when Chrome starts without one", async () => {
    const harness = createHarness({ cdp: createFakeCdp(null) });
    const context = await openContext(harness);

    await context.newPage();

    expect(harness.cdp.newPage).toHaveBeenCalledTimes(1);
  });
});

/*
 * A person solving a captcha is told apart from a challenge that passed by
 * itself by trusted input events inside the page.
 */
describe("createChromeBrowser user input tracking", () => {
  it("reports no user input before a person touches the page", async () => {
    const harness = createHarness();
    const context = await openContext(harness);
    const page = await context.newPage();

    expect(page.hadUserInput?.()).toBe(false);
  });

  it("installs the tracker before the website is opened", async () => {
    const harness = createHarness();
    const context = await openContext(harness);

    await context.newPage();

    expect(harness.cdp.initialTab?.addInitScript).toHaveBeenCalledTimes(1);

    const [script] = harness.cdp.initialTab?.addInitScript.mock.calls[0] ?? [];

    // Only events of a person count: scripts cannot make an event trusted.
    expect(script).toContain("isTrusted");
    expect(harness.cdp.initialTab?.fake.goto).not.toHaveBeenCalled();
  });

  it("reports user input once the page announces a trusted event", async () => {
    const harness = createHarness();
    const context = await openContext(harness);
    const page = await context.newPage();
    const [script] = harness.cdp.initialTab?.addInitScript.mock.calls[0] ?? [];
    const marker = /console\.debug\(("[^"]+")\)/.exec(script ?? "")?.[1];

    expect(marker).toBeDefined();

    harness.cdp.initialTab?.emitConsole(JSON.parse(marker ?? '""') as string);

    expect(page.hadUserInput?.()).toBe(true);
  });

  it("ignores other messages of the page console", async () => {
    const harness = createHarness();
    const context = await openContext(harness);
    const page = await context.newPage();

    harness.cdp.initialTab?.emitConsole("hello from the website");

    expect(page.hadUserInput?.()).toBe(false);
  });

  it("does not carry the input of one page over to the next one", async () => {
    const firstTab = createFakeTab();
    const secondTab = createFakeTab();
    const harness = createHarness({ cdp: createFakeCdp(firstTab) });
    const context = await openContext(harness);

    const first = await context.newPage();
    const [script] = firstTab.addInitScript.mock.calls[0] ?? [];
    const marker = JSON.parse(
      /console\.debug\(("[^"]+")\)/.exec(script ?? "")?.[1] ?? '""'
    ) as string;

    firstTab.emitConsole(marker);
    await first.close();

    const second = createFakeCdp(secondTab);

    harness.connect.mockResolvedValue(second.browser);

    const next = await context.newPage();

    expect(first.hadUserInput?.()).toBe(true);
    expect(next.hadUserInput?.()).toBe(false);
  });
});
