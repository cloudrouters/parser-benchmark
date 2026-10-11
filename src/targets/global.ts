import type { Target } from "./types.js";

export const GLOBAL_TARGETS: readonly Target[] = [
  { name: "Google", url: "https://www.google.com/", content: ["Google"] },
  { name: "Bing", url: "https://www.bing.com/", content: ["Bing"] },
  { name: "Amazon", url: "https://www.amazon.com/", content: ["Amazon"] },
  {
    name: "eBay",
    url: "https://www.ebay.com/",
    content: ["eBay"],
    saveDiagnostics: true,
  },
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
];
