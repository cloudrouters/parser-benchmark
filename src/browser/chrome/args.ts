export interface ChromeArgsOptions {
  userDataDir: string;
  /** Proxy URL for `--proxy-server`, or `null` for a direct connection. */
  proxyServer: string | null;
}

/**
 * Command line of a real Chrome that can be driven over the DevTools protocol.
 *
 * `--remote-debugging-port` makes Chrome report `navigator.webdriver = true`,
 * which antibot systems such as Wildberries' reject. Disabling the
 * `AutomationControlled` blink feature restores the value of a regular
 * browser. Playwright's `--enable-automation` is deliberately not used.
 */
export function buildChromeArgs({
  userDataDir,
  proxyServer,
}: ChromeArgsOptions): string[] {
  return [
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1366,768",
    ...(proxyServer === null ? [] : [`--proxy-server=${proxyServer}`]),
    // The initial blank tab stays open, so closing a site tab never quits Chrome.
    "about:blank",
  ];
}
