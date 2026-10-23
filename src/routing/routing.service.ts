import { Inject, Injectable } from "@nestjs/common";
import { generateText } from "ai";
import { GATEWAY_CONFIG } from "../config/config.module.js";
import type { GatewayConfig } from "../config/gateway-config.js";
import { MODEL_CATALOG, type ModelCatalog } from "../providers/model-catalog.js";
import { chainError } from "./chain-error.js";
import { classifyFailure, type Failure } from "./classify-failure.js";
import type {
  ChatRouter,
  GatewayCaller,
  GatewayRequest,
  GatewayResult,
  RouteCatalog,
} from "./gateway.types.js";
import { GatewayError } from "./gateway-error.js";
import { mergeParams } from "./merge-params.js";
import { buildProviderOptions } from "./provider-options.js";
import { rawJsonOutput } from "./raw-json-output.js";
import { type PlannedCandidate, planRoute, type RoutePlan, visibleRouteIds } from "./route-plan.js";
import { type AttemptRecord, ROUTING_RECORDER, type RoutingRecorder } from "./routing-recorder.js";
import { type ResultParts, toResultParts } from "./to-gateway-result.js";

type AttemptOutcome = { ignoredParams: readonly string[]; record: AttemptRecord } & (
  | { type: "ok"; parts: ResultParts }
  | { type: "failed"; failure: Failure }
  | { type: "aborted" }
);

@Injectable()
export class RoutingService implements ChatRouter, RouteCatalog {
  constructor(
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(MODEL_CATALOG) private readonly catalog: ModelCatalog,
    @Inject(ROUTING_RECORDER) private readonly recorder: RoutingRecorder,
  ) {}

  visibleRouteIds(caller: GatewayCaller): readonly string[] {
    return visibleRouteIds(this.config, caller);
  }

  /** SPEC-003 steps 5-6: try each candidate; only a retryable failure moves to the next. */
  async complete(
    request: GatewayRequest,
    caller: GatewayCaller,
    signal: AbortSignal,
  ): Promise<GatewayResult> {
    const plan = planRoute({ request, caller, config: this.config, catalog: this.catalog });
    const attempts: AttemptRecord[] = [];
    const failures: Failure[] = [];
    const ignoredParams = new Set<string>();
    let served: ResultParts | undefined;
    try {
      for (const candidate of plan.candidates) {
        const outcome = await this.attempt(candidate, plan, request, signal);
        attempts.push(outcome.record);
        for (const param of outcome.ignoredParams) ignoredParams.add(param);
        if (outcome.type === "ok") {
          served = outcome.parts;
          return this.result(plan, candidate, outcome.parts, attempts);
        }
        if (outcome.type === "aborted") {
          throw new GatewayError("upstream_unavailable", "The request was aborted by the client.");
        }
        failures.push(outcome.failure);
        if (!outcome.failure.retryable) break;
      }
      throw chainError(failures);
    } finally {
      this.recorder.completed({
        route: plan.routeId,
        routedBy: plan.routedBy,
        attempts,
        skipped: plan.skipped,
        ...(ignoredParams.size > 0 && { ignoredParams: [...ignoredParams] }),
        ...(served?.usageMissing && { usageMissing: true as const }),
        ...(served?.finishReasonRaw !== undefined && { finishReasonRaw: served.finishReasonRaw }),
      });
    }
  }

  private result(
    plan: RoutePlan,
    candidate: PlannedCandidate,
    parts: ResultParts,
    attempts: readonly AttemptRecord[],
  ): GatewayResult {
    return {
      ...parts,
      route: plan.routeId,
      routedBy: plan.routedBy,
      modelKey: candidate.modelKey,
      attempts: attempts.length,
    };
  }

  private async attempt(
    candidate: PlannedCandidate,
    plan: RoutePlan,
    request: GatewayRequest,
    clientSignal: AbortSignal,
  ): Promise<AttemptOutcome> {
    const { languageModel, config } = candidate.model;
    const { options: providerOptions, ignoredParams } = buildProviderOptions(
      candidate.model,
      request.parallelToolCalls,
    );
    const started = performance.now();
    const latency = () => Math.round(performance.now() - started);
    const timeout = AbortSignal.timeout(config.timeoutMs);
    try {
      const output = await generateText({
        model: languageModel,
        messages: [...request.messages],
        ...(request.tools !== undefined && { tools: request.tools }),
        ...(request.toolChoice !== undefined && { toolChoice: request.toolChoice }),
        ...(request.responseFormat !== undefined && {
          output: rawJsonOutput(request.responseFormat),
        }),
        ...mergeParams({ model: config, route: plan.route, request: request.params }),
        maxRetries: config.maxRetries,
        abortSignal: AbortSignal.any([clientSignal, timeout]),
        ...(providerOptions !== undefined && { providerOptions }),
      });
      return {
        type: "ok",
        parts: toResultParts(output),
        ignoredParams,
        record: { model: candidate.modelKey, outcome: "ok", latencyMs: latency() },
      };
    } catch (error) {
      if (clientSignal.aborted) {
        const record: AttemptRecord = {
          model: candidate.modelKey,
          outcome: "client_aborted",
          latencyMs: latency(),
        };
        return { type: "aborted", ignoredParams, record };
      }
      const failure = classifyFailure(error, { timedOut: timeout.aborted });
      const record: AttemptRecord = {
        model: candidate.modelKey,
        outcome: "error",
        ...(failure.status !== undefined && { status: failure.status }),
        kind: failure.kind,
        latencyMs: latency(),
      };
      return { type: "failed", failure, ignoredParams, record };
    }
  }
}
