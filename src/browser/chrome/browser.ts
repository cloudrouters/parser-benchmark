import { chromium } from "playwright";

import { CONFIG } from "../../shared/config.js";
import { getErrorMessage, ignoreCleanupError } from "../../shared/utils.js";
import type {
  ContextLike,
  ContextOptions,
  LaunchedBrowser,
  PageLike,
} from "../types.js";
import {
  startChromeProcess,
  type ChromeProcess,
  type StartChromeOptions,
} from "./process.js";

/*
 * Minimal structural views of the Playwright objects used to drive a Chrome
 * that was started outside of Playwright. Real Playwright objects are
 * assignable to them, and tests can provide small fakes.
 */

export interface CdpSession {
  send(method: "Browser.close"): Promise<unknown>;
}

export interface CdpContext {
  pages(): readonly PageLike[];
  newPage(): Promise<PageLike>;
}

export interface CdpBrowser {
  contexts(): readonly CdpContext[];
  newBrowserCDPSession(): Promise<CdpSession>;
  close(): Promise<void>;
}

export interface ChromeBrowserDeps {
  startProcess(
    options: Pick<StartChromeOptions, "proxyServer">
  ): Promise<ChromeProcess>;
  connect(endpoint: string): Promise<CdpBrowser>;
}

const DEFAULT_DEPS: ChromeBrowserDeps = {
  startProcess: (options) => startChromeProcess(options),
  connect: (endpoint) => chromium.connectOverCDP(endpoint),
};

/**
 * Quits Chrome completely: asks it to close, falls back to killing the
 * process tree, then removes the temporary profile.
 */
async function shutdownChrome(
  chromeProcess: ChromeProcess,
  cdp: CdpBrowser | null
): Promise<void> {
  let quitRequested = false;

  if (cdp !== null) {
    try {
      const session = await cdp.newBrowserCDPSession();

      await session.send("Browser.close");

      quitRequested = true;
    } catch {
      // Chrome is unreachable or already closing; the fallback below handles it.
    }
  }

  const exited =
    quitRequested &&
    (await chromeProcess.waitForExit(CONFIG.chromeShutdownTimeoutMs));

  try {
    if (!exited) {
      await chromeProcess.forceKill();
    }
  } catch (error) {
    console.warn(
      "Could not stop Chrome (the profile is left on disk): " +
        getErrorMessage(error)
    );

    return;
  }

  await cdp?.close().catch(ignoreCleanupError);

  try {
    await chromeProcess.removeProfile();
  } catch (error) {
    console.warn(
      `Could not remove the temporary Chrome profile: ${getErrorMessage(error)}`
    );
  }
}

/**
 * The benchmark drives a single tab: the one Chrome opens at startup. Using
 * it for the target means no blank tab precedes the site. Closing the last
 * tab would quit Chrome on Windows and Linux, so `close()` resets the tab to
 * a blank page and the whole browser is closed with the context.
 */
function createReusableTab(tab: PageLike): PageLike {
  return {
    url: () => tab.url(),
    title: () => tab.title(),
    locator: (selector) => tab.locator(selector),
    evaluate: (expression) => tab.evaluate(expression),
    goto: (url, options) => tab.goto(url, options),
    screenshot: (options) => tab.screenshot(options),
    close: async () => {
      await tab.goto("about:blank", {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.pageTimeoutMs,
      });
    },
  };
}

/**
 * Real Google Chrome as a `BrowserLike`.
 *
 * Every context is a separate Chrome process with its own new profile, so
 * closing a context closes the whole browser and discards the profile.
 * Locale, time zone and viewport of the context options are not emulated:
 * a real Chrome reports the settings of the machine it runs on.
 */
export function createChromeBrowser(
  deps: ChromeBrowserDeps = DEFAULT_DEPS
): LaunchedBrowser {
  return {
    newContext: async (options: ContextOptions): Promise<ContextLike> => {
      const chromeProcess = await deps.startProcess({
        proxyServer: options.proxy?.server ?? null,
      });

      let cdp: CdpBrowser | null = null;

      try {
        cdp = await deps.connect(chromeProcess.endpoint);

        const defaultContext = cdp.contexts()[0];

        if (defaultContext === undefined) {
          throw new Error("Chrome did not provide a default browser context.");
        }

        const connected = cdp;

        const tab = createReusableTab(
          defaultContext.pages()[0] ?? (await defaultContext.newPage())
        );

        return {
          newPage: () => Promise.resolve(tab),
          close: () => shutdownChrome(chromeProcess, connected),
        };
      } catch (error) {
        await shutdownChrome(chromeProcess, cdp);

        throw error;
      }
    },

    // Every context owns and closes its own Chrome process.
    close: () => Promise.resolve(),
  };
}
