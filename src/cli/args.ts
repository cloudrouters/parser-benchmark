import { parseArgs } from "node:util";

import {
  DEFAULT_BROWSER_NAME,
  resolveBrowserProfile,
} from "../browser/profiles.js";
import type { BrowserProfile } from "../browser/types.js";
import {
  DEFAULT_TARGET_SET_NAME,
  resolveTargetSet,
} from "../targets/index.js";
import type { TargetSet } from "../targets/types.js";

export interface CliOptions {
  proxyUrl: string | null;
  reuseContext: boolean;
  browser: BrowserProfile;
  targetSet: TargetSet;
}

/**
 * Usage: parser [socks5://user:password@host:port]
 *               [--reuse-context] [--browser=<name>] [--targets=<name>]
 *
 * Unknown flags are rejected so that a typo does not silently change
 * what is being measured.
 */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      "reuse-context": { type: "boolean", default: false },
      browser: { type: "string", default: DEFAULT_BROWSER_NAME },
      targets: { type: "string", default: DEFAULT_TARGET_SET_NAME },
    },
  });

  return {
    proxyUrl: positionals[0] ?? null,
    reuseContext: values["reuse-context"],
    browser: resolveBrowserProfile(values.browser),
    targetSet: resolveTargetSet(values.targets),
  };
}
