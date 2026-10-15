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
  createChromeProfile,
  startChromeProcess,
  type ChromeProcess,
  type ChromeProfile,
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

/** A tab of Chrome, with what is needed to tell a person's input apart. */
export interface CdpPage extends PageLike {
  addInitScript(script: string): Promise<unknown>;
  on(event: "console", listener: (message: { text(): string }) => void): unknown;
}

export interface CdpContext {
  pages(): readonly CdpPage[];
  newPage(): Promise<CdpPage>;
}

export interface CdpBrowser {
  contexts(): readonly CdpContext[];
  newBrowserCDPSession(): Promise<CdpSession>;
  close(): Promise<void>;
}

export interface ChromeBrowserDeps {
  createProfile(): Promise<ChromeProfile>;
  startProcess(
    options: Pick<StartChromeOptions, "proxyServer" | "userDataDir">
  ): Promise<ChromeProcess>;
  connect(endpoint: string): Promise<CdpBrowser>;
}

const DEFAULT_DEPS: ChromeBrowserDeps = {
  createProfile: () => createChromeProfile(),
  startProcess: (options) => startChromeProcess(options),
  connect: (endpoint) => chromium.connectOverCDP(endpoint),
};

/**
 * Quits Chrome completely: asks it to close and falls back to killing the
 * process tree. The profile directory is not touched. Resolves `false` when
 * Chrome could not be stopped.
 */
async function shutdownChrome(
  chromeProcess: ChromeProcess,
  cdp: CdpBrowser | null
): Promise<boolean> {
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
    console.warn(`Could not stop Chrome: ${getErrorMessage(error)}`);

    return false;
  }

  await cdp?.close().catch(ignoreCleanupError);

  return true;
}

const USER_INPUT_MARKER = "parser-benchmark:user-input";

/*
 * Runs in every document and frame of the page. `isTrusted` is false for
 * events that scripts create, so only a person's input is announced.
 *
 * A key press always counts. A click counts when it is on a control
 * (Avito's "Продолжить", a checkbox, a captcha iframe) or inside a
 * subframe (hCaptcha). A click that only brings the Chrome window to
 * the front hits the page background and is ignored.
 */
const TRACK_USER_INPUT_SCRIPT = `(() => {
  const report = () => {
    console.debug(${JSON.stringify(USER_INPUT_MARKER)});
  };

  const isControlClick = (event) => {
    const el = event.target;
    return el instanceof Element && el.closest(
      "button, a, input, textarea, select, iframe, [role='button'], [role='checkbox']"
    ) !== null;
  };

  window.addEventListener("keydown", (event) => {
    if (event.isTrusted) {
      report();
    }
  }, true);

  window.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }

    if (window !== window.top || isControlClick(event)) {
      report();
    }
  }, true);
})();`;

/**
 * Starts watching for a person's input. Must run before the website is
 * opened, so that the script is part of every document that loads.
 */
async function trackUserInput(tab: CdpPage): Promise<() => boolean> {
  let hadInput = false;

  tab.on("console", (message) => {
    if (message.text() === USER_INPUT_MARKER) {

      hadInput = true;
    }
  });

  await tab.addInitScript(TRACK_USER_INPUT_SCRIPT);

  return () => hadInput;
}

/** One running Chrome with the only tab it opened at startup. */
interface LaunchedChrome {
  readonly tab: CdpPage;
  readonly hadUserInput: () => boolean;
  stop(): Promise<boolean>;
}

/**
 * Starts Chrome on the profile and connects to it. The first tab Chrome opens
 * is the one that is driven, so no blank tab precedes the website.
 */
async function launchChrome(
  deps: ChromeBrowserDeps,
  userDataDir: string,
  proxyServer: string | null
): Promise<LaunchedChrome> {
  const chromeProcess = await deps.startProcess({ proxyServer, userDataDir });

  let cdp: CdpBrowser | null = null;

  try {
    cdp = await deps.connect(chromeProcess.endpoint);

    const defaultContext = cdp.contexts()[0];

    if (defaultContext === undefined) {
      throw new Error("Chrome did not provide a default browser context.");
    }

    const connected = cdp;

    const tab = defaultContext.pages()[0] ?? (await defaultContext.newPage());

    const hadUserInput = await trackUserInput(tab);

    return {
      tab,
      hadUserInput,
      stop: () => shutdownChrome(chromeProcess, connected),
    };
  } catch (error) {
    await shutdownChrome(chromeProcess, cdp);

    throw error;
  }
}

function createPage(
  chrome: LaunchedChrome,
  close: () => Promise<void>
): PageLike {
  const { tab } = chrome;

  return {
    url: () => tab.url(),
    title: () => tab.title(),
    locator: (selector) => tab.locator(selector),
    evaluate: (expression) => tab.evaluate(expression),
    goto: (url, options) => tab.goto(url, options),
    reload: (options) => tab.reload(options),
    screenshot: (options) => tab.screenshot(options),
    close,
    hadUserInput: chrome.hadUserInput,
  };
}

/**
 * Real Google Chrome as a `BrowserLike`.
 *
 * A context owns a profile directory, a page owns a Chrome process:
 * - opening a page starts a new Chrome on the profile of the context;
 * - closing the page quits that whole Chrome, but the profile stays, so the
 *   next page starts a restarted browser that still has the cookies and other
 *   storage of the previous one (a reused context);
 * - closing the context removes the profile.
 *
 * A new context has a new empty profile. Locale, time zone and viewport of
 * the context options are not emulated: a real Chrome reports the settings
 * of the machine it runs on.
 */
export function createChromeBrowser(
  deps: ChromeBrowserDeps = DEFAULT_DEPS
): LaunchedBrowser {
  return {
    newContext: async (options: ContextOptions): Promise<ContextLike> => {
      const profile = await deps.createProfile();

      const proxyServer = options.proxy?.server ?? null;

      let running: LaunchedChrome | null = null;

      const stopRunning = async (): Promise<boolean> => {
        if (running === null) {
          return true;
        }

        const chrome = running;

        running = null;

        return chrome.stop();
      };

      return {
        newPage: async () => {
          if (running !== null) {
            throw new Error("A Chrome page is already open in this context.");
          }

          const chrome = await launchChrome(
            deps,
            profile.directory,
            proxyServer
          );

          running = chrome;

          return createPage(chrome, async () => {
            // A page that was already closed, or its Chrome stopped by the
            // context, has nothing left to quit.
            if (running === chrome) {
              await stopRunning();
            }
          });
        },

        close: async () => {
          if (!(await stopRunning())) {
            console.warn(
              `The temporary Chrome profile is left on disk: ${profile.directory}`
            );

            return;
          }

          try {
            await profile.remove();
          } catch (error) {
            console.warn(
              `Could not remove the temporary Chrome profile: ${getErrorMessage(error)}`
            );
          }
        },
      };
    },

    // Every context owns and stops its own Chrome processes.
    close: () => Promise.resolve(),
  };
}
