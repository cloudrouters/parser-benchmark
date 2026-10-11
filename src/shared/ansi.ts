const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  white: "\x1b[97m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[96m",
} as const;

function color(text: string, ansiColor: string): string {
  return `${ansiColor}${text}${ANSI.reset}`;
}

export function boldWhite(text: string): string {
  return color(`${ANSI.bold}${text}`, ANSI.white);
}

export function green(text: string): string {
  return color(text, ANSI.green);
}

export function red(text: string): string {
  return color(text, ANSI.red);
}

export function cyan(text: string): string {
  return color(text, ANSI.cyan);
}
