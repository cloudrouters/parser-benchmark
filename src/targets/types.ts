export interface Target {
  readonly name: string;
  readonly url: string;
  readonly content: readonly string[];
  /**
   * Save the final URL, title, body preview and a screenshot
   * when a challenge stays unresolved for this target.
   */
  readonly saveDiagnostics?: boolean;
}

export interface TargetSet {
  readonly name: string;
  readonly targets: readonly Target[];
}
