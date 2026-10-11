import { describe, expect, it } from "vitest";

import { resolveTargetSet, TARGET_SETS } from "../../src/targets/index.js";

describe("target sets", () => {
  it("registers every set under a unique name", () => {
    const names = TARGET_SETS.map((set) => set.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("global");
  });

  it("gives every target a name, an http(s) url and expected content", () => {
    for (const set of TARGET_SETS) {
      for (const target of set.targets) {
        expect(target.name).not.toBe("");
        expect(target.url).toMatch(/^https?:\/\//);
        expect(target.content.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("resolveTargetSet", () => {
  it("resolves the global set with the originally supported websites", () => {
    const { name, targets } = resolveTargetSet("global");

    expect(name).toBe("global");
    expect(
      targets.map(({ name: targetName, url, content }) => ({
        name: targetName,
        url,
        content,
      }))
    ).toEqual([
      { name: "Google", url: "https://www.google.com/", content: ["Google"] },
      { name: "Bing", url: "https://www.bing.com/", content: ["Bing"] },
      { name: "Amazon", url: "https://www.amazon.com/", content: ["Amazon"] },
      { name: "eBay", url: "https://www.ebay.com/", content: ["eBay"] },
      { name: "Walmart", url: "https://www.walmart.com/", content: ["Walmart"] },
      {
        name: "Booking",
        url: "https://www.booking.com/",
        content: ["Booking.com"],
      },
      {
        name: "LinkedIn",
        url: "https://www.linkedin.com/",
        content: ["LinkedIn"],
      },
    ]);
  });

  it("requests challenge diagnostics only for eBay", () => {
    const withDiagnostics = resolveTargetSet("global")
      .targets.filter((target) => target.saveDiagnostics === true)
      .map((target) => target.name);

    expect(withDiagnostics).toEqual(["eBay"]);
  });

  it("throws and lists the available sets for an unknown name", () => {
    expect(() => resolveTargetSet("mars")).toThrow(
      'Unknown target set "mars". Available: global.'
    );
  });
});
