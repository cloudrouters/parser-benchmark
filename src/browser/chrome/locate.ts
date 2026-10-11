import { win32 } from "node:path";

export const CHROME_PATH_ENV = "CHROME_PATH";

export interface LocateChromeOptions {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
}

const CHROME_NOT_FOUND_MESSAGE =
  "Google Chrome was not found. Install it from " +
  `https://www.google.com/chrome/ or set ${CHROME_PATH_ENV} to the executable.`;

const WINDOWS_RELATIVE_PATH = "Google\\Chrome\\Application\\chrome.exe";

const WINDOWS_INSTALL_ROOT_VARIABLES = [
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "LOCALAPPDATA",
] as const;

function getCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string[] {
  switch (platform) {
    case "darwin":
      return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];

    case "win32":
      return WINDOWS_INSTALL_ROOT_VARIABLES.flatMap((variable) => {
        const root = env[variable];

        return root === undefined || root === ""
          ? []
          : [win32.join(root, WINDOWS_RELATIVE_PATH)];
      });

    default:
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/chrome",
      ];
  }
}

/**
 * Finds the installed Google Chrome executable. `CHROME_PATH` takes
 * precedence and is never silently ignored: a wrong value is an error.
 */
export function locateChromeExecutable({
  platform,
  env,
  exists,
}: LocateChromeOptions): string {
  const customPath = env[CHROME_PATH_ENV];

  if (customPath !== undefined && customPath !== "") {
    if (!exists(customPath)) {
      throw new Error(
        `${CHROME_PATH_ENV} points to a missing file: "${customPath}".`
      );
    }

    return customPath;
  }

  const found = getCandidates(platform, env).find(exists);

  if (found === undefined) {
    throw new Error(CHROME_NOT_FOUND_MESSAGE);
  }

  return found;
}
