export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Passed to `.catch()` of cleanup operations such as closing a page or a
 * context. Cleanup errors must not mask the original benchmark result.
 */
export function ignoreCleanupError(): void {
  // Intentionally empty: see the JSDoc above.
}
