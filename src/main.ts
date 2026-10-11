import { writeFile } from "node:fs/promises";

import { runTarget } from "./benchmark/runner.js";
import { launchBrowser } from "./browser/profiles.js";
import type { LaunchedBrowser } from "./browser/types.js";
import { checkInternet } from "./checks/ip-check.js";
import { parseCliArgs } from "./cli/args.js";
import {
  startProxyBridge,
  stopProxyBridge,
  type LocalProxy,
} from "./proxy/proxy-bridge.js";
import { validateProxyUrl } from "./proxy/proxy-url.js";
import {
  createOutput,
  formatRunHeader,
  formatSummary,
} from "./report/format.js";
import type { TargetResult } from "./results/types.js";
import { CONFIG } from "./shared/config.js";
import { getErrorMessage, ignoreCleanupError } from "./shared/utils.js";

export async function main(argv: readonly string[]): Promise<void> {
  let browser: LaunchedBrowser | null = null;

  let proxyBridge: LocalProxy | null = null;

  try {
    const options = parseCliArgs(argv);

    validateProxyUrl(options.proxyUrl);

    console.log(formatRunHeader(options));

    if (options.proxyUrl !== null) {
      proxyBridge = await startProxyBridge(options.proxyUrl);
    }

    const localPort = proxyBridge?.port ?? null;

    browser = await launchBrowser(options.browser);

    if (options.proxyUrl !== null) {
      console.log("Checking connection through SOCKS5...");
    } else {
      console.log("Checking internet connection...");
    }

    const externalIP = await checkInternet(browser, localPort);

    if (externalIP === null) {
      console.log("");

      console.log("Benchmark stopped.");

      return;
    }

    const allResults: TargetResult[] = [];

    for (const target of options.targetSet.targets) {
      const results = await runTarget(
        browser,
        target,
        localPort,
        options.reuseContext
      );

      allResults.push({ target, results });
    }

    console.log(formatSummary(allResults));

    await writeFile(
      CONFIG.outputFile,
      JSON.stringify(createOutput(externalIP, allResults, options), null, 2),
      "utf8"
    );

    console.log("");

    console.log(`Results saved to ${CONFIG.outputFile}`);
  } catch (error) {
    console.error("");

    console.error("Benchmark failed:");

    console.error(getErrorMessage(error));

    process.exitCode = 1;
  } finally {
    if (browser !== null) {
      await browser.close().catch(ignoreCleanupError);
    }

    await stopProxyBridge(proxyBridge);
  }
}
