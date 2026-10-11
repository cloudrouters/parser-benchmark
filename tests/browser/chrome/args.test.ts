import { describe, expect, it } from "vitest";

import { buildChromeArgs } from "../../../src/browser/chrome/args.js";

describe("buildChromeArgs", () => {
  it("runs Chrome in a dedicated profile with a DevTools port chosen by Chrome", () => {
    const args = buildChromeArgs({ userDataDir: "/tmp/profile", proxyServer: null });

    expect(args).toContain("--user-data-dir=/tmp/profile");
    expect(args).toContain("--remote-debugging-port=0");
  });

  it("skips first-run and default-browser prompts", () => {
    const args = buildChromeArgs({ userDataDir: "/tmp/profile", proxyServer: null });

    expect(args).toContain("--no-first-run");
    expect(args).toContain("--no-default-browser-check");
  });

  it("hides the automation marker that remote debugging otherwise sets", () => {
    const args = buildChromeArgs({ userDataDir: "/tmp/profile", proxyServer: null });

    expect(args).toContain("--disable-blink-features=AutomationControlled");
    expect(args).not.toContain("--enable-automation");
  });

  it("opens a window of the benchmark viewport size", () => {
    const args = buildChromeArgs({ userDataDir: "/tmp/profile", proxyServer: null });

    expect(args).toContain("--window-size=1366,768");
  });

  it("routes traffic through the proxy only when one is given", () => {
    const direct = buildChromeArgs({ userDataDir: "/tmp/profile", proxyServer: null });
    const proxied = buildChromeArgs({
      userDataDir: "/tmp/profile",
      proxyServer: "http://127.0.0.1:12345",
    });

    expect(direct.some((arg) => arg.startsWith("--proxy-server"))).toBe(false);
    expect(proxied).toContain("--proxy-server=http://127.0.0.1:12345");
  });

  it("starts on a blank tab that the benchmark then reuses for the target", () => {
    const args = buildChromeArgs({ userDataDir: "/tmp/profile", proxyServer: null });

    expect(args.at(-1)).toBe("about:blank");
  });
});
