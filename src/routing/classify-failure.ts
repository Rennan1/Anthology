import { APICallError, RetryError } from "ai";

export type FailureKind =
  | "rate_limited"
  | "timeout"
  | "network"
  | "unavailable"
  | "rejected"
  | "upstream_auth"
  | "unknown";

export interface Failure {
  readonly retryable: boolean;
  readonly kind: FailureKind;
  readonly status?: number;
}

// SPEC-003: only these statuses send the request to the next candidate.
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function classifyStatus(status: number): Failure {
  const retryable = RETRYABLE_STATUSES.has(status);
  if (status === 429) return { retryable, kind: "rate_limited", status };
  // 401/403 mean the gateway's own provider key is wrong: a configuration error, not the client's.
  if (status === 401 || status === 403) return { retryable, kind: "upstream_auth", status };
  return { retryable, kind: retryable || status >= 500 ? "unavailable" : "rejected", status };
}

function hasNetworkCode(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
  return typeof code === "string" && NETWORK_ERROR_CODES.has(code);
}

/** The candidate's own timeout is reported by the caller, which owns that signal. */
export function classifyFailure(error: unknown, context: { timedOut: boolean }): Failure {
  if (context.timedOut) return { retryable: true, kind: "timeout" };
  // The SDK wraps an error that exhausted its retries; the last one is what happened.
  if (RetryError.isInstance(error)) return classifyFailure(error.lastError, context);
  if (APICallError.isInstance(error)) {
    if (error.statusCode !== undefined) return classifyStatus(error.statusCode);
    return error.isRetryable
      ? { retryable: true, kind: "network" }
      : { retryable: false, kind: "unknown" };
  }
  if (hasNetworkCode(error)) return { retryable: true, kind: "network" };
  return { retryable: false, kind: "unknown" };
}
