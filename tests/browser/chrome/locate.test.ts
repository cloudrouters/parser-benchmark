import { describe, expect, it } from "vitest";

import { locateChromeExecutable } from "../../../src/browser/chrome/locate.js";

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function existsOnly(...paths: string[]): (path: string) => boolean {
  return (path) => paths.includes(path);
}

describe("locateChromeExecutable", () => {
  it("prefers CHROME_PATH when the file exists", () => {
    expect(
      locateChromeExecutable({
        platform: "darwin",
        env: { CHROME_PATH: "/custom/chrome" },
        exists: existsOnly("/custom/chrome", MAC_CHROME),
      })
    ).toBe("/custom/chrome");
  });

  it("fails loudly when CHROME_PATH points to a missing file", () => {
    expect(() =>
      locateChromeExecutable({
        platform: "darwin",
        env: { CHROME_PATH: "/custom/chrome" },
        exists: existsOnly(MAC_CHROME),
      })
    ).toThrow('CHROME_PATH points to a missing file: "/custom/chrome".');
  });

  it("finds the application bundle binary on macOS", () => {
    expect(
      locateChromeExecutable({
        platform: "darwin",
        env: {},
        exists: existsOnly(MAC_CHROME),
      })
    ).toBe(MAC_CHROME);
  });

  it.each([
    [
      "Program Files",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ],
    [
      "Program Files (x86)",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
    [
      "the per-user install",
      "C:\\Users\\leon\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    ],
  ])("finds Chrome in %s on Windows", (_description, expected) => {
    expect(
      locateChromeExecutable({
        platform: "win32",
        env: {
          PROGRAMFILES: "C:\\Program Files",
          "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
          LOCALAPPDATA: "C:\\Users\\leon\\AppData\\Local",
        },
        exists: existsOnly(expected),
      })
    ).toBe(expected);
  });

  it("skips Windows locations whose environment variable is not set", () => {
    expect(
      locateChromeExecutable({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\leon\\AppData\\Local" },
        exists: existsOnly(
          "C:\\Users\\leon\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
        ),
      })
    ).toBe(
      "C:\\Users\\leon\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
    );
  });

  it("finds google-chrome on Linux", () => {
    expect(
      locateChromeExecutable({
        platform: "linux",
        env: {},
        exists: existsOnly("/usr/bin/google-chrome"),
      })
    ).toBe("/usr/bin/google-chrome");
  });

  it.each(["darwin", "win32", "linux"] as const)(
    "explains how to install Chrome when it is missing on %s",
    (platform) => {
      expect(() =>
        locateChromeExecutable({
          platform,
          env: {},
          exists: () => false,
        })
      ).toThrow(
        "Google Chrome was not found. Install it from " +
          "https://www.google.com/chrome/ or set CHROME_PATH to the executable."
      );
    }
  );
});
