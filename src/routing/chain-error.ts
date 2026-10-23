import type { Failure } from "./classify-failure.js";
import { GatewayError } from "./gateway-error.js";

/**
 * SPEC-001/SPEC-003: the single error the client sees when the chain ends without an answer.
 * Messages are fixed: never the upstream body, never a key.
 */
export function chainError(failures: readonly Failure[]): GatewayError {
  const last = failures.at(-1);
  if (last === undefined) {
    return new GatewayError("internal_error", "The request produced no attempt.");
  }
  if (!last.retryable) {
    // A non-retryable 4xx is the client's problem and its status goes through; auth and 5xx are ours.
    if (last.kind === "rejected" && last.status !== undefined) {
      return new GatewayError("upstream_rejected", "The upstream model rejected the request.", {
        upstreamStatus: last.status,
      });
    }
    return new GatewayError("upstream_unavailable", "The upstream model is unavailable.");
  }
  if (failures.every((failure) => failure.kind === "rate_limited")) {
    return new GatewayError("upstream_rate_limited", "The upstream models are rate limited.");
  }
  if (failures.every((failure) => failure.kind === "timeout")) {
    return new GatewayError("upstream_timeout", "The upstream models timed out.");
  }
  return new GatewayError("upstream_unavailable", "The upstream models are unavailable.");
}
