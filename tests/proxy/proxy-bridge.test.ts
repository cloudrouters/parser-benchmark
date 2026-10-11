import * as ProxyChain from "proxy-chain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  startProxyBridge,
  stopProxyBridge,
} from "../../src/proxy/proxy-bridge.js";

vi.mock("proxy-chain", () => ({
  anonymizeProxy: vi.fn(),
  closeAnonymizedProxy: vi.fn(),
}));

const SOCKS5_URL = "socks5://login:secret@1.2.3.4:1080";
const LOCAL_URL = "http://127.0.0.1:12345";

describe("startProxyBridge", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("does nothing in direct mode", async () => {
    await expect(startProxyBridge(null)).resolves.toBeNull();

    expect(ProxyChain.anonymizeProxy).not.toHaveBeenCalled();
  });

  it("starts a local http proxy that forwards to the socks5 proxy", async () => {
    vi.mocked(ProxyChain.anonymizeProxy).mockResolvedValue(LOCAL_URL);

    await expect(startProxyBridge(SOCKS5_URL)).resolves.toEqual({
      url: LOCAL_URL,
      port: "12345",
    });

    expect(ProxyChain.anonymizeProxy).toHaveBeenCalledWith({ url: SOCKS5_URL });
  });

  it("prints only the local proxy address, never the credentials", async () => {
    vi.mocked(ProxyChain.anonymizeProxy).mockResolvedValue(LOCAL_URL);

    await startProxyBridge(SOCKS5_URL);

    expect(console.log).toHaveBeenCalledWith("Starting local proxy bridge...");
    expect(console.log).toHaveBeenCalledWith("Local HTTP proxy: 127.0.0.1:12345");
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      "secret"
    );
  });

  it("propagates a startup failure", async () => {
    vi.mocked(ProxyChain.anonymizeProxy).mockRejectedValue(new Error("boom"));

    await expect(startProxyBridge(SOCKS5_URL)).rejects.toThrow("boom");
  });
});

describe("stopProxyBridge", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("does nothing when there is no bridge", async () => {
    await stopProxyBridge(null);

    expect(ProxyChain.closeAnonymizedProxy).not.toHaveBeenCalled();
  });

  it("closes the bridge together with its open connections", async () => {
    vi.mocked(ProxyChain.closeAnonymizedProxy).mockResolvedValue(true);

    await stopProxyBridge({ url: LOCAL_URL, port: "12345" });

    expect(ProxyChain.closeAnonymizedProxy).toHaveBeenCalledWith(LOCAL_URL, true);
  });

  it("does not throw when closing fails", async () => {
    vi.mocked(ProxyChain.closeAnonymizedProxy).mockRejectedValue(
      new Error("already closed")
    );

    await expect(
      stopProxyBridge({ url: LOCAL_URL, port: "12345" })
    ).resolves.toBeUndefined();
  });
});
