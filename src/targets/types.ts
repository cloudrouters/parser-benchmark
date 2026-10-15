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
  /**
   * Visible placeholders that mean the page is still a loading shell.
   * While this is set, an empty body also counts as loading: VK paints
   * "VK | Welcome!" before any body text, then "загружается...".
   */
  readonly loadingContent?: readonly string[];
  /**
   * Reload the same tab if the document is still unresponsive after this
   * many milliseconds. Drom's Qrator stub can sit on a white `loading`
   * page until a person hits refresh; 5 seconds is enough to tell.
   */
  readonly stuckReloadMs?: number;
}

export interface TargetSet {
  readonly name: string;
  readonly targets: readonly Target[];
}
