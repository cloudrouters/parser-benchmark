import { describe, expect, it } from "vitest";

import {
  maskProxyUrl,
  validateProxyUrl,
} from "../../src/proxy/proxy-url.js";

describe("validateProxyUrl", () => {
  it("accepts a missing proxy (direct mode)", () => {
    expect(() => {
      validateProxyUrl(null);
    }).not.toThrow();
  });

  it("accepts a valid socks5 url", () => {
    expect(() => {
      validateProxyUrl("socks5://user:password@127.0.0.1:1080");
    }).not.toThrow();
  });

  it("rejects a value that is not a url", () => {
    expect(() => {
      validateProxyUrl("not a url");
    }).toThrow(
      'Invalid proxy URL. Expected: "socks5://user:password@host:port"'
    );
  });

  it("rejects a protocol other than socks5", () => {
    expect(() => {
      validateProxyUrl("http://user:password@127.0.0.1:8080");
    }).toThrow('Invalid proxy URL. Expected protocol: "socks5://"');
  });

  it("rejects a url without a host", () => {
    expect(() => {
      validateProxyUrl("socks5://:1080");
    }).toThrow(
      'Invalid proxy URL. Expected: "socks5://user:password@host:port"'
    );
  });

  it("rejects a url without a port", () => {
    expect(() => {
      validateProxyUrl("socks5://user:password@127.0.0.1");
    }).toThrow(
      'Invalid proxy URL. Expected: "socks5://user:password@host:port"'
    );
  });
});

describe("maskProxyUrl", () => {
  it("masks the password of a proxy url", () => {
    expect(maskProxyUrl("socks5://login:secret@1.2.3.4:1080")).toBe(
      "socks5://login:***@1.2.3.4:1080"
    );
  });

  it("keeps a url without credentials unchanged", () => {
    expect(maskProxyUrl("socks5://1.2.3.4:1080")).toBe("socks5://1.2.3.4:1080");
  });

  it("masks the password even when the url cannot be parsed", () => {
    const masked = maskProxyUrl("socks5://login:secret@host:notaport");

    expect(masked).toBe("socks5://login:***@host:notaport");
    expect(masked).not.toContain("secret");
  });

  it("returns an unparsable value without credentials as is", () => {
    expect(maskProxyUrl("not a url")).toBe("not a url");
  });
});
