import { describe, expect, it } from "vitest";

import { getContextOptions } from "../../src/browser/context.js";

describe("getContextOptions", () => {
  it("describes a desktop en-US browser without a proxy in direct mode", () => {
    expect(getContextOptions(null)).toEqual({
      locale: "en-US",
      timezoneId: "America/New_York",
      viewport: { width: 1366, height: 768 },
    });
  });

  it("routes traffic through the local proxy bridge port", () => {
    expect(getContextOptions("12345")).toEqual({
      locale: "en-US",
      timezoneId: "America/New_York",
      viewport: { width: 1366, height: 768 },
      proxy: { server: "http://127.0.0.1:12345" },
    });
  });
});
