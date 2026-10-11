import type { Target } from "./types.js";

/**
 * Every service saves challenge diagnostics, so an unknown captcha or antibot
 * page can be analysed and handled the way Wildberries' 498 stub is.
 */
export const RU_TARGETS: readonly Target[] = [
  {
    name: "Yandex",
    url: "https://ya.ru/",
    content: ["Яндекс"],
    saveDiagnostics: true,
  },
  {
    name: "Yandex Zen",
    url: "https://dzen.ru/",
    content: ["Дзен"],
    saveDiagnostics: true,
  },
  {
    name: "Yandex Market",
    url: "https://market.yandex.ru/",
    content: ["Яндекс Маркет"],
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
  },
  {
    name: "Avito",
    url: "https://www.avito.ru/",
    content: ["Авито"],
    saveDiagnostics: true,
  },
  {
    name: "HH",
    url: "https://hh.ru/",
    content: ["hh.ru"],
    saveDiagnostics: true,
  },
  {
    name: "Cian",
    url: "https://www.cian.ru/",
    content: ["ЦИАН"],
    saveDiagnostics: true,
  },
  {
    name: "Drom",
    url: "https://www.drom.ru/",
    content: ["Дром"],
    saveDiagnostics: true,
  },
  {
    name: "VK",
    url: "https://vk.com/",
    content: ["VK"],
    saveDiagnostics: true,
  },
];
