import type { LaunchOptions } from "playwright";

/** Browser launched and driven by Playwright itself. */
export interface PlaywrightBrowserProfile {
  readonly name: string;
  readonly launchOptions: LaunchOptions;
}

/**
 * Installed Google Chrome started as a separate process with a new temporary
 * profile and driven over the DevTools protocol.
 */
export interface SystemChromeProfile {
  readonly name: string;
  readonly kind: "system-chrome";
}

export type BrowserProfile = PlaywrightBrowserProfile | SystemChromeProfile;

export function isSystemChromeProfile(
  profile: BrowserProfile
): profile is SystemChromeProfile {
  return "kind" in profile;
}

export interface ContextOptions {
  locale: string;
  timezoneId: string;
  viewport: {
    width: number;
    height: number;
  };
  proxy?: {
    server: string;
  };
}

/*
 * Minimal structural views of the Playwright API used by the benchmark.
 * Real Playwright objects are assignable to them without type assertions,
 * and tests can provide small typed fakes instead of full Playwright mocks.
 */

export interface LocatorLike {
  innerText(options: { timeout: number }): Promise<string>;
}

export interface PageReader {
  url(): string;
  title(): Promise<string>;
  locator(selector: "body"): LocatorLike;
  /** Evaluates a JavaScript expression in the page and returns its value. */
  evaluate(expression: string): Promise<unknown>;
  /**
   * Reloads the current document. Optional because a page that cannot reload
   * (for example a test double of a read-only snapshot) is left as it is.
   */
  reload?(options: {
    waitUntil: "domcontentloaded";
    timeout: number;
  }): Promise<ResponseLike | null>;
}

export interface ResponseLike {
  status(): number;
}

export interface PageLike extends PageReader {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number }
  ): Promise<ResponseLike | null>;
  /**
   * Reloads the current document. Used when a challenge page is still
   * showing after the challenge window, so the site can try its check again
   * without opening a new tab.
   */
  reload(options: {
    waitUntil: "domcontentloaded";
    timeout: number;
  }): Promise<ResponseLike | null>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  close(): Promise<void>;
  /**
   * Whether a person interacted with the page to solve a captcha: a trusted
   * key press, a click on a control, or a click inside a captcha iframe.
   * A click that only brings the window to the front does not count.
   * If a person acted and the site then ran an automatic check, the attempt
   * is still manual. Optional because only some browsers can tell: a page
   * that cannot is never reported as solved by a person.
   */
  hadUserInput?(): boolean;
}

export interface ContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

export interface BrowserLike {
  newContext(options: ContextOptions): Promise<ContextLike>;
}

export interface LaunchedBrowser extends BrowserLike {
  close(): Promise<void>;
}
