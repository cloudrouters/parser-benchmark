import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../../src/cli/args.js";
import { GLOBAL_TARGETS } from "../../src/targets/global.js";

describe("parseCliArgs", () => {
  it("uses direct mode, a new context per attempt, chromium and the global targets by default", () => {
    const options = parseCliArgs([]);

    expect(options.proxyUrl).toBeNull();
    expect(options.reuseContext).toBe(false);
    expect(options.browser.name).toBe("chromium");
    expect(options.targetSet.name).toBe("global");
    expect(options.targetSet.targets).toBe(GLOBAL_TARGETS);
  });

  it("takes the first positional argument as the proxy url", () => {
    const options = parseCliArgs(["socks5://login:pass@1.2.3.4:1080"]);

    expect(options.proxyUrl).toBe("socks5://login:pass@1.2.3.4:1080");
  });

  it("ignores additional positional arguments", () => {
    const options = parseCliArgs(["socks5://a:b@1.2.3.4:1080", "extra"]);

    expect(options.proxyUrl).toBe("socks5://a:b@1.2.3.4:1080");
  });

  it("enables context reuse with --reuse-context in any position", () => {
    expect(parseCliArgs(["--reuse-context"]).reuseContext).toBe(true);
    expect(
      parseCliArgs(["--reuse-context", "socks5://a:b@1.2.3.4:1080"])
    ).toMatchObject({
      reuseContext: true,
      proxyUrl: "socks5://a:b@1.2.3.4:1080",
    });
  });

  it.each([["--browser=chrome"], ["--browser", "chrome"]])(
    "selects the chrome profile with %j",
    (...argv) => {
      const { browser } = parseCliArgs(argv);

      expect(browser.name).toBe("chrome");
      expect(browser.launchOptions).toEqual({ channel: "chrome" });
    }
  );

  it.each([["--targets=global"], ["--targets", "global"]])(
    "selects the global target set with %j",
    (...argv) => {
      expect(parseCliArgs(argv).targetSet.name).toBe("global");
    }
  );

  it.each([["--targets=ru"], ["--targets", "ru"]])(
    "selects the ru target set with %j",
    (...argv) => {
      expect(parseCliArgs(argv).targetSet.name).toBe("ru");
    }
  );

  it("rejects an unknown flag", () => {
    expect(() => parseCliArgs(["--browzer=chrome"])).toThrow();
  });

  it("rejects an unknown browser and lists the available ones", () => {
    expect(() => parseCliArgs(["--browser=netscape"])).toThrow(
      'Unknown browser "netscape". Available: chromium, chrome.'
    );
  });

  it("rejects an unknown target set and lists the available ones", () => {
    expect(() => parseCliArgs(["--targets=mars"])).toThrow(
      'Unknown target set "mars". Available: global, ru.'
    );
  });
});
