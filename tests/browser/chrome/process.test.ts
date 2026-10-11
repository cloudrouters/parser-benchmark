import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forceKillProcessTree,
  parseDevToolsActivePort,
  startChromeProcess,
  type ChromeProcess,
  type ChromeProcessDeps,
} from "../../../src/browser/chrome/process.js";

class FakeChrome extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;

  exit(code: number): void {
    this.exitCode = code;
    this.emit("exit", code);
  }
}

interface Harness {
  child: FakeChrome;
  deps: ChromeProcessDeps;
  spawn: ReturnType<typeof vi.fn>;
  forceKillTree: ReturnType<typeof vi.fn>;
  profileDir: () => string;
}

function createHarness(
  onSpawn: (child: FakeChrome, userDataDir: string) => void = (_child, dir) => {
    writeFileSync(`${dir}/DevToolsActivePort`, "9222\n/devtools/browser/abc\n");
  }
): Harness {
  const child = new FakeChrome();
  let userDataDir = "";

  const spawn = vi.fn((_command: string, args: readonly string[]) => {
    const flag = args.find((arg) => arg.startsWith("--user-data-dir="));

    userDataDir = flag?.slice("--user-data-dir=".length) ?? "";
    mkdirSync(userDataDir, { recursive: true });
    onSpawn(child, userDataDir);

    return child;
  });
  const forceKillTree = vi.fn(() => Promise.resolve());

  return {
    child,
    spawn,
    forceKillTree,
    profileDir: () => userDataDir,
    deps: {
      locateExecutable: () => "/path/to/chrome",
      spawn,
      forceKillTree,
    },
  };
}

const startedProcesses: ChromeProcess[] = [];

async function start(
  harness: Harness,
  options: { proxyServer?: string | null; startTimeoutMs?: number } = {}
): Promise<ChromeProcess> {
  const chrome = await startChromeProcess(
    { proxyServer: options.proxyServer ?? null, startTimeoutMs: options.startTimeoutMs },
    harness.deps
  );

  startedProcesses.push(chrome);

  return chrome;
}

afterEach(async () => {
  await Promise.all(
    startedProcesses.splice(0).map((chrome) => chrome.removeProfile())
  );
});

describe("parseDevToolsActivePort", () => {
  it("reads the port from the first line", () => {
    expect(parseDevToolsActivePort("9222\n/devtools/browser/abc\n")).toBe(9222);
  });

  it("accepts Windows line endings", () => {
    expect(parseDevToolsActivePort("9222\r\n/devtools/browser/abc\r\n")).toBe(
      9222
    );
  });

  it.each(["", "\n", "abc\n/x", "0\n/x", "70000\n/x", "-5\n/x"])(
    "rejects the invalid content %j",
    (content) => {
      expect(() => parseDevToolsActivePort(content)).toThrow(
        "DevToolsActivePort does not contain a valid port."
      );
    }
  );
});

describe("startChromeProcess", () => {
  it("spawns the located executable with a temporary profile and returns the DevTools endpoint", async () => {
    const harness = createHarness();

    const chrome = await start(harness, {
      proxyServer: "http://127.0.0.1:12345",
    });

    expect(chrome.endpoint).toBe("http://127.0.0.1:9222");
    expect(harness.spawn).toHaveBeenCalledTimes(1);

    const [command, args] = harness.spawn.mock.calls[0] as [string, string[]];

    expect(command).toBe("/path/to/chrome");
    expect(args).toContain(`--user-data-dir=${harness.profileDir()}`);
    expect(args).toContain("--proxy-server=http://127.0.0.1:12345");
    expect(harness.profileDir()).not.toBe("");
  });

  it("creates a different profile for every launch", async () => {
    const first = createHarness();
    const second = createHarness();

    await start(first);
    await start(second);

    expect(first.profileDir()).not.toBe(second.profileDir());
  });

  it("waits until Chrome writes the DevToolsActivePort file", async () => {
    const harness = createHarness((_child, dir) => {
      setTimeout(() => {
        writeFileSync(`${dir}/DevToolsActivePort`, "9333\n/devtools/browser/x");
      }, 250);
    });

    const chrome = await start(harness);

    expect(chrome.endpoint).toBe("http://127.0.0.1:9333");
  });

  it("removes the profile and reports the exit code when Chrome exits before it is ready", async () => {
    const harness = createHarness((child) => {
      setTimeout(() => {
        child.exit(7);
      }, 50);
    });

    await expect(startChromeProcess({ proxyServer: null }, harness.deps)).rejects.toThrow(
      "Chrome exited with code 7 before DevTools became available."
    );
    expect(existsSync(harness.profileDir())).toBe(false);
  });

  it("kills Chrome and removes the profile when DevTools does not become available in time", async () => {
    // Chrome never writes DevToolsActivePort.
    const harness = createHarness(() => undefined);

    await expect(
      startChromeProcess({ proxyServer: null, startTimeoutMs: 300 }, harness.deps)
    ).rejects.toThrow("Chrome did not expose DevTools within 0.3 seconds.");
    expect(harness.forceKillTree).toHaveBeenCalledWith(4242);
    expect(existsSync(harness.profileDir())).toBe(false);
  });

  it("reports a failure to spawn the executable and removes the profile", async () => {
    const harness = createHarness((child) => {
      setTimeout(() => {
        child.emit("error", new Error("spawn /path/to/chrome ENOENT"));
      }, 50);
    });

    await expect(startChromeProcess({ proxyServer: null }, harness.deps)).rejects.toThrow(
      "Could not start Chrome: spawn /path/to/chrome ENOENT"
    );
    expect(existsSync(harness.profileDir())).toBe(false);
  });

  it("does not create a profile when Chrome cannot be located", async () => {
    const harness = createHarness();
    const failing: ChromeProcessDeps = {
      ...harness.deps,
      locateExecutable: () => {
        throw new Error("Google Chrome was not found.");
      },
    };

    await expect(startChromeProcess({ proxyServer: null }, failing)).rejects.toThrow(
      "Google Chrome was not found."
    );
    expect(harness.spawn).not.toHaveBeenCalled();
  });
});

describe("ChromeProcess", () => {
  it("removes its profile directory", async () => {
    const harness = createHarness();
    const chrome = await start(harness);

    expect(existsSync(harness.profileDir())).toBe(true);

    await chrome.removeProfile();

    expect(existsSync(harness.profileDir())).toBe(false);
  });

  it("tolerates removing a profile that is already gone", async () => {
    const harness = createHarness();
    const chrome = await start(harness);

    await rm(harness.profileDir(), { recursive: true, force: true });

    await expect(chrome.removeProfile()).resolves.toBeUndefined();
  });

  it("reports an already exited process without waiting", async () => {
    const harness = createHarness();
    const chrome = await start(harness);

    harness.child.exit(0);

    await expect(chrome.waitForExit(5_000)).resolves.toBe(true);
  });

  it("reports an exit that happens while waiting", async () => {
    const harness = createHarness();
    const chrome = await start(harness);

    const waiting = chrome.waitForExit(5_000);

    setTimeout(() => {
      harness.child.exit(0);
    }, 50);

    await expect(waiting).resolves.toBe(true);
  });

  it("gives up waiting when the process keeps running", async () => {
    const harness = createHarness();
    const chrome = await start(harness);

    await expect(chrome.waitForExit(100)).resolves.toBe(false);
  });

  it("kills the whole process tree on request", async () => {
    const harness = createHarness();
    const chrome = await start(harness);

    await chrome.forceKill();

    expect(harness.forceKillTree).toHaveBeenCalledWith(4242);
  });

  it("does not try to kill a process that has already exited", async () => {
    const harness = createHarness();
    const chrome = await start(harness);

    harness.child.exit(0);
    await chrome.forceKill();

    expect(harness.forceKillTree).not.toHaveBeenCalled();
  });
});

describe("forceKillProcessTree", () => {
  it("uses taskkill with the tree flag on Windows", async () => {
    const run = vi.fn(() => Promise.resolve());
    const kill = vi.fn();

    await forceKillProcessTree(4242, { platform: "win32", run, kill });

    expect(run).toHaveBeenCalledWith("taskkill", ["/PID", "4242", "/T", "/F"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("ignores taskkill reporting that the process no longer exists", async () => {
    const run = vi.fn(() => Promise.reject(Object.assign(new Error("not found"), { code: 128 })));

    await expect(
      forceKillProcessTree(4242, { platform: "win32", run, kill: vi.fn() })
    ).resolves.toBeUndefined();
  });

  it("surfaces other taskkill failures", async () => {
    const run = vi.fn(() => Promise.reject(Object.assign(new Error("denied"), { code: 5 })));

    await expect(
      forceKillProcessTree(4242, { platform: "win32", run, kill: vi.fn() })
    ).rejects.toThrow("denied");
  });

  it.each(["darwin", "linux"] as const)("sends SIGKILL on %s", async (platform) => {
    const run = vi.fn();
    const kill = vi.fn();

    await forceKillProcessTree(4242, { platform, run, kill });

    expect(kill).toHaveBeenCalledWith(4242, "SIGKILL");
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores a process that no longer exists", async () => {
    const kill = vi.fn(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });

    await expect(
      forceKillProcessTree(4242, { platform: "linux", run: vi.fn(), kill })
    ).resolves.toBeUndefined();
  });

  it("surfaces other kill failures", async () => {
    const kill = vi.fn(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    });

    await expect(
      forceKillProcessTree(4242, { platform: "linux", run: vi.fn(), kill })
    ).rejects.toThrow("not permitted");
  });
});
