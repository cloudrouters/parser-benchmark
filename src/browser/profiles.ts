import { chromium } from "playwright";

import { CONFIG } from "../shared/config.js";
import { createChromeBrowser } from "./chrome/browser.js";
import {
  isSystemChromeProfile,
  type BrowserProfile,
  type LaunchedBrowser,
} from "./types.js";

export const DEFAULT_BROWSER_NAME = "chromium";

/**
 * `chromium` is the Chromium bundled with Playwright. `chrome` is the
 * installed Google Chrome, started as an ordinary process with a new profile
 * for every context, so that it behaves like a real user's browser.
 */
export const BROWSER_PROFILES: readonly BrowserProfile[] = [
  { name: "chromium", launchOptions: {} },
  { name: "chrome", kind: "system-chrome" },
];

export function resolveBrowserProfile(name: string): BrowserProfile {
  const profile = BROWSER_PROFILES.find((item) => item.name === name);

  if (profile === undefined) {
    const available = BROWSER_PROFILES.map((item) => item.name).join(", ");

    throw new Error(`Unknown browser "${name}". Available: ${available}.`);
  }

  return profile;
}

export function launchBrowser(
  profile: BrowserProfile
): Promise<LaunchedBrowser> {
  if (isSystemChromeProfile(profile)) {
    return Promise.resolve(createChromeBrowser());
  }

  return chromium.launch({
    ...profile.launchOptions,
    headless: CONFIG.headless,
  });
}
