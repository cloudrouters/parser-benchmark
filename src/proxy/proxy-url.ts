export function maskProxyUrl(value: string): string {
  try {
    const url = new URL(value);

    if (url.username !== "") {
      url.password = "***";
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/^(socks5:\/\/[^:]+:)[^@]+(@.*)$/i, "$1***$2");
  }
}

export function validateProxyUrl(value: string | null): void {
  if (value === null) {
    return;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'Invalid proxy URL. Expected: "socks5://user:password@host:port"'
    );
  }

  if (url.protocol !== "socks5:") {
    throw new Error('Invalid proxy URL. Expected protocol: "socks5://"');
  }

  if (url.hostname === "" || url.port === "") {
    throw new Error(
      'Invalid proxy URL. Expected: "socks5://user:password@host:port"'
    );
  }
}
