import type { ContextOptions } from "./types.js";

export function getContextOptions(localPort: string | null): ContextOptions {
  const options: ContextOptions = {
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: {
      width: 1366,
      height: 768,
    },
  };

  if (localPort === null) {
    return options;
  }

  return {
    ...options,
    proxy: {
      server: `http://127.0.0.1:${localPort}`,
    },
  };
}
