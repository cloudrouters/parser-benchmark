export interface Target {
  readonly name: string;
  readonly url: string;
  readonly content: readonly string[];
  /**
   * Save the final URL, title, body preview and a screenshot
   * when a challenge stays unresolved for this target.
   */
  readonly saveDiagnostics?: boolean;
  /**
   * HTTP statuses that this site serves together with its antibot page
   * (for example Wildberries answers 498 first and shows the real content
   * once the browser check passes). Such a response counts as a delivered
   * request and the attempt waits for the challenge to resolve.
   */
  readonly challengeStatuses?: readonly number[];
}

export interface TargetSet {
  readonly name: string;
  readonly targets: readonly Target[];
}
