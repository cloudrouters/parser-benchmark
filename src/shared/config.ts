export const CONFIG = {
  attempts: 10,
  headless: false,
  ipCheckUrl: "https://api.ipify.org/?format=json",
  internetCheckTimeoutMs: 15_000,
  pageTimeoutMs: 30_000,
  navigationRecoveryTimeoutMs: 5_000,
  contentWaitTimeoutMs: 5_000,
  challengeWaitTimeoutMs: 30_000,
  // A page can need a long time to render once its antibot check is gone.
  postChallengeContentWaitTimeoutMs: 60_000,
  contentCheckIntervalMs: 250,
  /*
   * After a captcha the first "Авито" in a loading stub is not the homepage.
   * A document that is `interactive`/`complete`, or whose body is already
   * this long while still `loading`, is treated as painted.
   */
  minPaintedBodyLength: 800,
  /*
   * Painted polls required after a challenge before the tab is closed, so
   * the real page is on screen. Four polls at 250 ms is one second.
   */
  postChallengePaintedPolls: 4,
  attemptDelayMs: 1_000,
  chromeStartTimeoutMs: 30_000,
  chromeStartPollIntervalMs: 100,
  chromeShutdownTimeoutMs: 10_000,
  outputFile: "benchmark-results.json",
} as const;

export const CHALLENGE_PATTERNS = [
  "just a moment",
  "checking your browser",
  "verify you are human",
  "verify you are a human",
  "unusual traffic",
  "access denied",
  "security check",
  "captcha",
  "recaptcha",
  "hcaptcha",
  "cf-chl-",
  "cloudflare",
  "akamai",
  "bot manager",
  "are you a robot",
  // Wildberries antibot stub (served with HTTP 498).
  "проверяем браузер",
  "подозрительная активность",
  "подозрительную активность",
  // Avito antibot (HTTP 439/429), both its stub page and its modal dialog.
  "доступ ограничен",
] as const;
