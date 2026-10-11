import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_PROFILES,
  launchBrowser,
  resolveBrowserProfile,
} from "../../src/browser/profiles.js";
import { CONFIG } from "../../src/shared/config.js";

const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));

vi.mock("playwright", () => ({ chromium: { launch: launchMock } }));

describe("resolveBrowserProfile", () => {
  it("provides the chromium and chrome profiles", () => {
    expect(BROWSER_PROFILES.map((profile) => profile.name)).toEqual([
      "chromium",
      "chrome",
    ]);
  });

  it("resolves chromium to the bundled browser", () => {
    expect(resolveBrowserProfile("chromium")).toEqual({
      name: "chromium",
      launchOptions: {},
    });
  });

  it("resolves chrome to the installed Google Chrome channel", () => {
    expect(resolveBrowserProfile("chrome")).toEqual({
      name: "chrome",
      launchOptions: { channel: "chrome" },
    });
  });

  it("throws and lists the available profiles for an unknown name", () => {
    expect(() => resolveBrowserProfile("firefox")).toThrow(
      'Unknown browser "firefox". Available: chromium, chrome.'
    );
  });
});

describe("launchBrowser", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("launches bundled chromium with the configured headless mode", async () => {
    await launchBrowser(resolveBrowserProfile("chromium"));

    expect(launchMock).toHaveBeenCalledWith({
      headless: CONFIG.headless,
    });
  });

  it("launches Google Chrome through the chrome channel", async () => {
    await launchBrowser(resolveBrowserProfile("chrome"));

    expect(launchMock).toHaveBeenCalledWith({
      channel: "chrome",
      headless: CONFIG.headless,
    });
  });
});
