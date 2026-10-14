import { describe, expect, it } from "vitest";

import { resolveTargetSet, TARGET_SETS } from "../../src/targets/index.js";

describe("target sets", () => {
  it("registers every set under a unique name", () => {
    const names = TARGET_SETS.map((set) => set.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("global");
    expect(names).toContain("ru");
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

  it("resolves the ru set with Russian services, Wildberries after Yandex Market", () => {
    const { name, targets } = resolveTargetSet("ru");

    expect(name).toBe("ru");
    expect(
      targets.map(({ name: targetName, url, content }) => ({
        name: targetName,
        url,
        content,
      }))
    ).toEqual([
      { name: "Yandex", url: "https://ya.ru/", content: ["Яндекс"] },
      {
        name: "Yandex Market",
        url: "https://market.yandex.ru/",
        content: ["Яндекс Маркет"],
      },
      {
        name: "Wildberries",
        url: "https://www.wildberries.ru/",
        content: ["Wildberries"],
      },
      { name: "Ozon", url: "https://www.ozon.ru/", content: ["Ozon"] },
      { name: "Avito", url: "https://www.avito.ru/", content: ["Авито"] },
      { name: "HH", url: "https://hh.ru/", content: ["hh.ru"] },
      { name: "Cian", url: "https://www.cian.ru/", content: ["ЦИАН"] },
      { name: "Drom", url: "https://www.drom.ru/", content: ["Дром"] },
      { name: "VK", url: "https://vk.com/", content: ["VK"] },
      { name: "Yandex Zen", url: "https://dzen.ru/", content: ["Дзен"] },
    ]);
  });

  it("requests challenge diagnostics for every ru service", () => {
    const { targets } = resolveTargetSet("ru");

    expect(targets.every((target) => target.saveDiagnostics === true)).toBe(
      true
    );
  });

  it("declares challenge statuses only for Ozon (403), Wildberries (498) and Avito (439, 429)", () => {
    const withChallengeStatuses = Object.fromEntries(
      resolveTargetSet("ru")
        .targets.filter((target) => target.challengeStatuses !== undefined)
        .map(({ name: targetName, challengeStatuses }) => [
          targetName,
          challengeStatuses,
        ])
    );

    expect(withChallengeStatuses).toEqual({
      // Ozon's antibot serves its self-reloading check page with HTTP 403.
      Ozon: [403],
      Wildberries: [498],
      Avito: [439, 429],
    });
  });

  it("requests challenge diagnostics only for eBay", () => {
    const withDiagnostics = resolveTargetSet("global")
      .targets.filter((target) => target.saveDiagnostics === true)
      .map((target) => target.name);

    expect(withDiagnostics).toEqual(["eBay"]);
  });

  it("throws and lists the available sets for an unknown name", () => {
    expect(() => resolveTargetSet("mars")).toThrow(
      'Unknown target set "mars". Available: global, ru.'
    );
  });
});
