import { Logger } from "@nestjs/common";
import type { FailureKind } from "./classify-failure.js";
import type { RoutedBy } from "./gateway.types.js";
import type { SkippedCandidate } from "./route-plan.js";

export interface AttemptRecord {
  readonly model: string;
  readonly outcome: "ok" | "error" | "client_aborted";
  readonly status?: number;
  readonly kind?: FailureKind;
  readonly latencyMs: number;
}

/** The `routing.completed` event of SPEC-003 ("Registro"): one per request. */
export interface RoutingCompletedEvent {
  readonly route: string;
  readonly routedBy: RoutedBy;
  readonly attempts: readonly AttemptRecord[];
  readonly skipped: readonly SkippedCandidate[];
  /** Request parameters no candidate honored (SPEC-005), e.g. `parallel_tool_calls`. */
  readonly ignoredParams?: readonly string[];
  readonly usageMissing?: true;
  readonly finishReasonRaw?: string;
}

export interface RoutingRecorder {
  completed(event: RoutingCompletedEvent): void;
}
export const ROUTING_RECORDER = Symbol("ROUTING_RECORDER");

/** Until the pino logger of SPEC-008 lands, the event goes out through the Nest logger. */
export class LoggerRoutingRecorder implements RoutingRecorder {
  private readonly logger = new Logger("routing");

  completed(event: RoutingCompletedEvent): void {
    // SPEC-003: 401/403 from the upstream mean a wrong provider key, which is an error to page on.
    const providerKeyRejected = event.attempts.some((attempt) => attempt.kind === "upstream_auth");
    const line = JSON.stringify({ event: "routing.completed", ...event });
    if (providerKeyRejected) this.logger.error(line);
    else this.logger.log(line);
  }
}
