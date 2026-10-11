import { chromium } from "playwright";

import { CONFIG } from "../shared/config.js";
import type { BrowserProfile, LaunchedBrowser } from "./types.js";

export const DEFAULT_BROWSER_NAME = "chromium";

/**
 * Chrome is launched by the same Playwright browser type as Chromium,
 * only through the "chrome" channel, which requires an installed Google Chrome.
 */
export const BROWSER_PROFILES: readonly BrowserProfile[] = [
  { name: "chromium", launchOptions: {} },
  { name: "chrome", launchOptions: { channel: "chrome" } },
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
  return chromium.launch({
    ...profile.launchOptions,
    headless: CONFIG.headless,
  });
}
