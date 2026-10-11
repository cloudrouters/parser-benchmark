import { GLOBAL_TARGETS } from "./global.js";
import { RU_TARGETS } from "./ru.js";
import type { TargetSet } from "./types.js";

export const DEFAULT_TARGET_SET_NAME = "global";

/**
 * To add a target set, create a file next to `global.ts` and register it here.
 */
export const TARGET_SETS: readonly TargetSet[] = [
  { name: "global", targets: GLOBAL_TARGETS },
  { name: "ru", targets: RU_TARGETS },
];

export function resolveTargetSet(name: string): TargetSet {
  const targetSet = TARGET_SETS.find((set) => set.name === name);

  if (targetSet === undefined) {
    const available = TARGET_SETS.map((set) => set.name).join(", ");

    throw new Error(`Unknown target set "${name}". Available: ${available}.`);
  }

  return targetSet;
}
