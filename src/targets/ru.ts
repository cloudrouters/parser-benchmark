import type { Target } from "./types.js";

/**
 * Every service saves challenge diagnostics, so an unknown captcha or antibot
 * page can be analysed and handled the way Wildberries' 498 stub is.
 */
export const RU_TARGETS: readonly Target[] = [
  {
    name: "Avito",
    url: "https://www.avito.ru/",
    content: ["Авито"],
    saveDiagnostics: true,
    // Qrator antibot: 439 is its check page, 429 is its "problem with IP" page.
    challengeStatuses: [439, 429],
  },
  {
    name: "Drom",
    url: "https://www.drom.ru/",
    content: ["Дром"],
    saveDiagnostics: true,
  },
  {
    name: "Wildberries",
    url: "https://www.wildberries.ru/",
    content: ["Wildberries"],
    saveDiagnostics: true,
    challengeStatuses: [498],
  },
  {
    name: "Ozon",
    url: "https://www.ozon.ru/",
    content: ["Ozon"],
    saveDiagnostics: true,
    // Antibot: a new profile gets a 403 check page that reloads itself into the site.
    challengeStatuses: [403],
  },
  {
    name: "Yandex",
    url: "https://ya.ru/",
    content: ["Яндекс"],
    saveDiagnostics: true,
  },
  {
    name: "Yandex Market",
    url: "https://market.yandex.ru/",
    content: ["Яндекс Маркет"],
    saveDiagnostics: true,
  },
  {
    name: "Yandex Zen",
    url: "https://dzen.ru/",
    content: ["Дзен"],
    saveDiagnostics: true,
  },
  {
    name: "Cian",
    url: "https://www.cian.ru/",
    content: ["ЦИАН"],
    saveDiagnostics: true,
  },
  {
    name: "HH",
    url: "https://hh.ru/",
    content: ["hh.ru"],
    saveDiagnostics: true,
  },
  {
    name: "VK",
    url: "https://vk.com/",
    content: ["VK"],
    saveDiagnostics: true,
    loadingContent: ["загружается"],
  },
];
