import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { CONFIG } from "../../shared/config.js";
import { getErrorMessage, sleep } from "../../shared/utils.js";
import { buildChromeArgs } from "./args.js";
import { locateChromeExecutable } from "./locate.js";

const execFileAsync = promisify(execFile);

const MAX_TCP_PORT = 65_535;

/** Windows keeps files of a closing browser locked for a short while. */
const PROFILE_REMOVAL_RETRIES = 10;
const PROFILE_REMOVAL_RETRY_DELAY_MS = 200;

const TASKKILL_PROCESS_NOT_FOUND = 128;

export interface ChromeProcess {
  /** HTTP endpoint of the DevTools protocol, for example `http://127.0.0.1:9222`. */
  readonly endpoint: string;
  /** Resolves `true` when the process exited within the timeout. */
  waitForExit(timeoutMs: number): Promise<boolean>;
  /** Kills Chrome together with its child processes. */
  forceKill(): Promise<void>;
}

/**
 * A Chrome user data directory that outlives the processes started on it, so
 * cookies and other storage survive a restart of Chrome.
 */
export interface ChromeProfile {
  readonly directory: string;
  /** Deletes the directory. No Chrome may be running on it. */
  remove(): Promise<void>;
}

/** The part of a Node child process that is needed to supervise Chrome. */
export interface SpawnedChrome {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

export interface ChromeProcessDeps {
  locateExecutable(): string;
  spawn(command: string, args: readonly string[]): SpawnedChrome;
  forceKillTree(pid: number): Promise<void>;
}

export interface StartChromeOptions {
  proxyServer: string | null;
  /** Profile directory of the new process; it is left untouched on exit. */
  userDataDir: string;
  startTimeoutMs?: number | undefined;
}

export interface KillDeps {
  platform: NodeJS.Platform;
  run(command: string, args: readonly string[]): Promise<unknown>;
  kill(pid: number, signal: NodeJS.Signals): void;
}

function hasCode(error: unknown, code: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code === code
    : false;
}

/**
 * Kills a process and everything it started. Chrome spawns helper processes
 * that outlive a killed parent on Windows, so `taskkill /T` is required there.
 * A process that is already gone is not an error.
 */
export async function forceKillProcessTree(
  pid: number,
  deps: KillDeps = {
    platform: process.platform,
    run: (command, args) => execFileAsync(command, [...args]),
    kill: (targetPid, signal) => {
      process.kill(targetPid, signal);
    },
  }
): Promise<void> {
  if (deps.platform === "win32") {
    try {
      await deps.run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    } catch (error) {
      if (!hasCode(error, TASKKILL_PROCESS_NOT_FOUND)) {
        throw error;
      }
    }

    return;
  }

  try {
    deps.kill(pid, "SIGKILL");
  } catch (error) {
    if (!hasCode(error, "ESRCH")) {
      throw error;
    }
  }
}

const DEFAULT_DEPS: ChromeProcessDeps = {
  locateExecutable: () =>
    locateChromeExecutable({
      platform: process.platform,
      env: process.env,
      exists: existsSync,
    }),
  spawn: (command, args) => spawn(command, [...args], { stdio: "ignore" }),
  forceKillTree: (pid) => forceKillProcessTree(pid),
};

/**
 * Chrome writes `<port>\n<browser websocket path>` to this file in its profile
 * directory once the DevTools server listens.
 */
export function parseDevToolsActivePort(content: string): number {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const port = Number(firstLine.trim());

  if (!Number.isInteger(port) || port < 1 || port > MAX_TCP_PORT) {
    throw new Error("DevToolsActivePort does not contain a valid port.");
  }

  return port;
}

async function readDevToolsPort(userDataDir: string): Promise<number | null> {
  let content: string;

  try {
    content = await readFile(join(userDataDir, "DevToolsActivePort"), "utf8");
  } catch {
    // Chrome has not created the file yet.
    return null;
  }

  try {
    return parseDevToolsActivePort(content);
  } catch {
    // The file may be observed half-written; the next poll sees the full content.
    return null;
  }
}

function removeDirectory(directory: string): Promise<void> {
  return rm(directory, {
    recursive: true,
    force: true,
    maxRetries: PROFILE_REMOVAL_RETRIES,
    retryDelay: PROFILE_REMOVAL_RETRY_DELAY_MS,
  });
}

interface ExitState {
  readonly hasExited: () => boolean;
  readonly exited: Promise<void>;
  readonly spawnFailure: Promise<never>;
}

function trackExit(child: SpawnedChrome): ExitState {
  let hasExited = child.exitCode !== null;

  const exited = new Promise<void>((resolve) => {
    if (hasExited) {
      resolve();

      return;
    }

    child.once("exit", () => {
      hasExited = true;
      resolve();
    });
  });

  const spawnFailure = new Promise<never>((_resolve, reject) => {
    child.once("error", (error) => {
      reject(new Error(`Could not start Chrome: ${error.message}`));
    });
  });

  // The rejection is observed only while the start is awaited.
  spawnFailure.catch(() => undefined);

  return { hasExited: () => hasExited, exited, spawnFailure };
}

async function waitForDevToolsPort(
  userDataDir: string,
  child: SpawnedChrome,
  exit: ExitState,
  timeoutMs: number
): Promise<number> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (exit.hasExited()) {
      throw new Error(
        `Chrome exited with code ${String(child.exitCode)} ` +
          "before DevTools became available."
      );
    }

    const port = await readDevToolsPort(userDataDir);

    if (port !== null) {
      return port;
    }

    await Promise.race([
      sleep(CONFIG.chromeStartPollIntervalMs),
      exit.spawnFailure,
    ]);
  }

  throw new Error(
    `Chrome did not expose DevTools within ${String(timeoutMs / 1000)} seconds.`
  );
}

/**
 * Creates an empty profile directory in the system temporary folder. It is
 * never the profile of the user's Chrome, so a new profile starts without
 * cookies, cache or antibot history.
 */
export async function createChromeProfile(): Promise<ChromeProfile> {
  const directory = await mkdtemp(join(tmpdir(), "parser-benchmark-chrome-"));

  return { directory, remove: () => removeDirectory(directory) };
}

/**
 * Starts Google Chrome as an ordinary, separate process on the given profile.
 * The same profile can be started again after Chrome exited, and then it
 * keeps its storage. The caller owns the profile and removes it.
 */
export async function startChromeProcess(
  options: StartChromeOptions,
  deps: ChromeProcessDeps = DEFAULT_DEPS
): Promise<ChromeProcess> {
  const { userDataDir } = options;

  const executable = deps.locateExecutable();

  /*
   * A Chrome that was killed leaves its DevToolsActivePort behind. Without
   * removing it the start would connect to the port of the dead process.
   */
  await rm(join(userDataDir, "DevToolsActivePort"), { force: true });

  const child = deps.spawn(
    executable,
    buildChromeArgs({ userDataDir, proxyServer: options.proxyServer })
  );

  const exit = trackExit(child);

  const forceKill = async (): Promise<void> => {
    if (!exit.hasExited() && child.pid !== undefined) {
      await deps.forceKillTree(child.pid);
    }
  };

  try {
    const port = await waitForDevToolsPort(
      userDataDir,
      child,
      exit,
      options.startTimeoutMs ?? CONFIG.chromeStartTimeoutMs
    );

    return {
      endpoint: `http://127.0.0.1:${String(port)}`,

      waitForExit: async (timeoutMs) => {
        if (exit.hasExited()) {
          return true;
        }

        let timer: NodeJS.Timeout | undefined;

        const timedOut = new Promise<false>((resolve) => {
          timer = setTimeout(() => {
            resolve(false);
          }, timeoutMs);
        });

        try {
          return await Promise.race([exit.exited.then(() => true as const), timedOut]);
        } finally {
          clearTimeout(timer);
        }
      },

      forceKill,
    };
  } catch (error) {
    await forceKill().catch((killError: unknown) => {
      console.warn(`Could not stop Chrome: ${getErrorMessage(killError)}`);
    });

    throw error;
  }
}
