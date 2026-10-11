import type { Target } from "../targets/types.js";

export interface AttemptResult {
  attempt: number;
  status: number | null;
  requestSuccess: boolean;
  contentSuccess: boolean;
  challenge: boolean;
  responseTime: number;
  finalUrl: string | null;
  title: string | null;
  error: string | null;
}

export interface TargetResult {
  target: Target;
  results: AttemptResult[];
}

export interface ResponseStats {
  avg: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
}
