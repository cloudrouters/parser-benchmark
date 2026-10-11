import * as ProxyChain from "proxy-chain";

export interface LocalProxy {
  url: string;
  port: string;
}

/**
 * Chromium cannot authenticate against SOCKS5 proxies, so a local HTTP proxy
 * is started that forwards all traffic through the SOCKS5 connection.
 * Returns `null` in direct mode.
 */
export async function startProxyBridge(
  socks5Url: string | null
): Promise<LocalProxy | null> {
  if (socks5Url === null) {
    return null;
  }

  console.log("Starting local proxy bridge...");

  const anonymizedUrl = await ProxyChain.anonymizeProxy({
    url: socks5Url,
  });

  const parsedUrl = new URL(anonymizedUrl);

  console.log(`Local HTTP proxy: ${parsedUrl.hostname}:${parsedUrl.port}`);

  return {
    url: anonymizedUrl,
    port: parsedUrl.port,
  };
}

export async function stopProxyBridge(
  bridge: LocalProxy | null
): Promise<void> {
  if (bridge === null) {
    return;
  }

  try {
    await ProxyChain.closeAnonymizedProxy(bridge.url, true);
  } catch {
    // Cleanup errors must not mask the original benchmark result.
  }
}
