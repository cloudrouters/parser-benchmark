import type { LaunchOptions } from "playwright";

export interface BrowserProfile {
  readonly name: string;
  readonly launchOptions: LaunchOptions;
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
}

export interface ResponseLike {
  status(): number;
}

export interface PageLike extends PageReader {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number }
  ): Promise<ResponseLike | null>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  close(): Promise<void>;
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
