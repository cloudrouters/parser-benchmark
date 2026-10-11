import { describe, expect, it } from "vitest";

import { boldWhite, cyan, green, red } from "../../src/shared/ansi.js";

describe("ansi helpers", () => {
  it("wraps text with the ANSI color codes and a reset", () => {
    expect(green("OK")).toBe("\x1b[32mOK\x1b[0m");
    expect(red("FAIL")).toBe("\x1b[31mFAIL\x1b[0m");
    expect(cyan("1.2.3.4")).toBe("\x1b[96m1.2.3.4\x1b[0m");
    expect(boldWhite("Google")).toBe("\x1b[97m\x1b[1mGoogle\x1b[0m");
  });
});
