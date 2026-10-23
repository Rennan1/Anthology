import { Inject, Injectable } from "@nestjs/common";
import { generateText, streamText, type TextStreamPart, type ToolSet } from "ai";
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
  GatewayStream,
  RouteCatalog,
} from "./gateway.types.js";
import { GatewayError } from "./gateway-error.js";
import { mergeParams } from "./merge-params.js";
import { buildProviderOptions } from "./provider-options.js";
import { rawJsonOutput } from "./raw-json-output.js";
import { type PlannedCandidate, planRoute, type RoutePlan, visibleRouteIds } from "./route-plan.js";
import {
  type AttemptRecord,
  ROUTING_RECORDER,
  type RoutingCompletedEvent,
  type RoutingRecorder,
} from "./routing-recorder.js";
import { type ResultParts, toResultParts } from "./to-gateway-result.js";

type StreamPart = TextStreamPart<ToolSet>;

/** A stream that reached its commit point: the first part is in hand, the rest still upstream. */
interface CommittedStream {
  readonly first: StreamPart;
  readonly iterator: AsyncIterator<StreamPart>;
  readonly started: number;
}

type ChainAttempt<T> = { ignoredParams: readonly string[]; record: AttemptRecord } & (
  | { type: "ok"; value: T }
  | { type: "failed"; failure: Failure }
  | { type: "aborted" }
);

type Walked<T> = {
  readonly attempts: AttemptRecord[];
  readonly ignoredParams: ReadonlySet<string>;
} & (
  | { readonly ok: true; readonly candidate: PlannedCandidate; readonly value: T }
  | { readonly ok: false; readonly error: GatewayError }
);

const latencySince = (started: number) => Math.round(performance.now() - started);

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

  async complete(
    request: GatewayRequest,
    caller: GatewayCaller,
    signal: AbortSignal,
  ): Promise<GatewayResult> {
    const plan = planRoute({ request, caller, config: this.config, catalog: this.catalog });
    const walked = await this.walkChain<ResultParts>(plan, (candidate) =>
      this.attemptGenerate(candidate, plan, request, signal),
    );
    this.recordCompleted(plan, walked, walked.ok ? walked.value : undefined);
    if (!walked.ok) throw walked.error;
    return {
      ...walked.value,
      route: plan.routeId,
      routedBy: plan.routedBy,
      modelKey: walked.candidate.modelKey,
      attempts: walked.attempts.length,
    };
  }

  /** SPEC-003/006: resolves at the commit point, with the stream ready to be written. */
  async stream(
    request: GatewayRequest,
    caller: GatewayCaller,
    signal: AbortSignal,
  ): Promise<GatewayStream> {
    const plan = planRoute({ request, caller, config: this.config, catalog: this.catalog });
    const walked = await this.walkChain<CommittedStream>(plan, (candidate) =>
      this.attemptStream(candidate, plan, request, signal),
    );
    if (!walked.ok) {
      this.recordCompleted(plan, walked);
      throw walked.error;
    }
    return {
      route: plan.routeId,
      routedBy: plan.routedBy,
      modelKey: walked.candidate.modelKey,
      attempts: walked.attempts.length,
      parts: this.relay(plan, walked, walked.value, signal),
    };
  }

  /** SPEC-003 steps 5-6: try each candidate; only a retryable failure moves to the next. */
  private async walkChain<T>(
    plan: RoutePlan,
    attempt: (candidate: PlannedCandidate) => Promise<ChainAttempt<T>>,
  ): Promise<Walked<T>> {
    const attempts: AttemptRecord[] = [];
    const failures: Failure[] = [];
    const ignoredParams = new Set<string>();
    for (const candidate of plan.candidates) {
      const outcome = await attempt(candidate);
      attempts.push(outcome.record);
      for (const param of outcome.ignoredParams) ignoredParams.add(param);
      if (outcome.type === "ok") {
        return { ok: true, candidate, value: outcome.value, attempts, ignoredParams };
      }
      if (outcome.type === "aborted") {
        const error = new GatewayError(
          "upstream_unavailable",
          "The request was aborted by the client.",
        );
        return { ok: false, error, attempts, ignoredParams };
      }
      failures.push(outcome.failure);
      if (!outcome.failure.retryable) break;
    }
    return { ok: false, error: chainError(failures), attempts, ignoredParams };
  }

  private recordCompleted(
    plan: RoutePlan,
    walked: Pick<Walked<unknown>, "attempts" | "ignoredParams">,
    served?: ResultParts,
  ): void {
    const event: RoutingCompletedEvent = {
      route: plan.routeId,
      routedBy: plan.routedBy,
      attempts: walked.attempts,
      skipped: plan.skipped,
      ...(walked.ignoredParams.size > 0 && { ignoredParams: [...walked.ignoredParams] }),
      ...(served?.usageMissing && { usageMissing: true as const }),
      ...(served?.finishReasonRaw !== undefined && { finishReasonRaw: served.finishReasonRaw }),
    };
    this.recorder.completed(event);
  }

  /** What `generateText` and `streamText` share: the request in AI SDK terms plus the model's own knobs. */
  private callOptions(candidate: PlannedCandidate, plan: RoutePlan, request: GatewayRequest) {
    const { languageModel, config } = candidate.model;
    const { options: providerOptions, ignoredParams } = buildProviderOptions(
      candidate.model,
      request.parallelToolCalls,
    );
    const options = {
      model: languageModel,
      messages: [...request.messages],
      ...(request.tools !== undefined && { tools: request.tools }),
      ...(request.toolChoice !== undefined && { toolChoice: request.toolChoice }),
      ...(request.responseFormat !== undefined && {
        output: rawJsonOutput(request.responseFormat),
      }),
      ...mergeParams({ model: config, route: plan.route, request: request.params }),
      maxRetries: config.maxRetries,
      ...(providerOptions !== undefined && { providerOptions }),
    };
    return { options, ignoredParams };
  }

  private async attemptGenerate(
    candidate: PlannedCandidate,
    plan: RoutePlan,
    request: GatewayRequest,
    clientSignal: AbortSignal,
  ): Promise<ChainAttempt<ResultParts>> {
    const { options, ignoredParams } = this.callOptions(candidate, plan, request);
    const started = performance.now();
    const timeout = AbortSignal.timeout(candidate.model.config.timeoutMs);
    try {
      const output = await generateText({
        ...options,
        abortSignal: AbortSignal.any([clientSignal, timeout]),
      });
      return {
        type: "ok",
        value: toResultParts(output),
        ignoredParams,
        record: { model: candidate.modelKey, outcome: "ok", latencyMs: latencySince(started) },
      };
    } catch (error) {
      return this.failedAttempt(
        candidate,
        error,
        clientSignal,
        timeout.aborted,
        ignoredParams,
        started,
      );
    }
  }

  /**
   * Streams until the first real part. The SDK emits `start` at once, before it has talked to the
   * provider, so that part is not the commit; `start-step` and anything later is (SPEC-003).
   * The candidate timeout covers only the time to that point: after it a long answer is fine.
   */
  private async attemptStream(
    candidate: PlannedCandidate,
    plan: RoutePlan,
    request: GatewayRequest,
    clientSignal: AbortSignal,
  ): Promise<ChainAttempt<CommittedStream>> {
    const { options, ignoredParams } = this.callOptions(candidate, plan, request);
    const started = performance.now();
    const attemptAbort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      attemptAbort.abort(new Error("candidate timeout"));
    }, candidate.model.config.timeoutMs);
    let iterator: AsyncIterator<StreamPart> | undefined;
    try {
      const result = streamText<ToolSet>({
        ...options,
        abortSignal: AbortSignal.any([clientSignal, attemptAbort.signal]),
        // Failures arrive as `error` parts and are handled below; the default would log them raw.
        onError: () => {},
      });
      iterator = result.fullStream[Symbol.asyncIterator]();
      const first = await firstUpstreamPart(iterator);
      if (first.type === "error") throw first.error;
      // An aborted call (our timeout or the client) ends the stream with `abort`, not with `error`.
      if (first.type === "abort") throw new Error("The upstream call was aborted.");
      clearTimeout(timer);
      return {
        type: "ok",
        value: { first, iterator, started },
        ignoredParams,
        record: { model: candidate.modelKey, outcome: "ok", latencyMs: latencySince(started) },
      };
    } catch (error) {
      clearTimeout(timer);
      void iterator?.return?.();
      return this.failedAttempt(candidate, error, clientSignal, timedOut, ignoredParams, started);
    }
  }

  private failedAttempt(
    candidate: PlannedCandidate,
    error: unknown,
    clientSignal: AbortSignal,
    timedOut: boolean,
    ignoredParams: readonly string[],
    started: number,
  ): ChainAttempt<never> {
    if (clientSignal.aborted) {
      const record: AttemptRecord = {
        model: candidate.modelKey,
        outcome: "client_aborted",
        latencyMs: latencySince(started),
      };
      return { type: "aborted", ignoredParams, record };
    }
    const failure = classifyFailure(error, { timedOut });
    const record: AttemptRecord = {
      model: candidate.modelKey,
      outcome: "error",
      ...(failure.status !== undefined && { status: failure.status }),
      kind: failure.kind,
      latencyMs: latencySince(started),
    };
    return { type: "failed", failure, ignoredParams, record };
  }

  /**
   * The committed stream, handed to the writer. When it ends (or the client leaves) the committed
   * attempt's record is finalized and `routing.completed` goes out, once.
   */
  private async *relay(
    plan: RoutePlan,
    walked: Walked<CommittedStream> & { ok: true },
    committed: CommittedStream,
    clientSignal: AbortSignal,
  ): AsyncGenerator<StreamPart> {
    let outcome: AttemptRecord["outcome"] = "ok";
    let finish: Extract<StreamPart, { type: "finish" }> | undefined;
    try {
      let part: StreamPart = committed.first;
      for (;;) {
        if (part.type === "error") outcome = "stream_error";
        if (part.type === "finish") finish = part;
        yield part;
        const next = await committed.iterator.next();
        if (next.done) break;
        part = next.value;
      }
    } catch (error) {
      // After an abort the SDK may reject its pending read; that is the client leaving, not a failure.
      if (!clientSignal.aborted) {
        outcome = "stream_error";
        throw error;
      }
    } finally {
      if (clientSignal.aborted) outcome = "client_aborted";
      await committed.iterator.return?.();
      const last = walked.attempts.length - 1;
      walked.attempts[last] = {
        model: walked.candidate.modelKey,
        outcome,
        latencyMs: latencySince(committed.started),
      };
      this.recordCompleted(plan, walked, finish && streamEndParts(finish));
    }
  }
}

async function firstUpstreamPart(iterator: AsyncIterator<StreamPart>): Promise<StreamPart> {
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error("The upstream stream ended before sending any part.");
    if (next.value.type !== "start") return next.value;
  }
}

function streamEndParts(finish: Extract<StreamPart, { type: "finish" }>): ResultParts {
  return toResultParts({
    text: "",
    toolCalls: [],
    finishReason: finish.finishReason,
    rawFinishReason: finish.rawFinishReason,
    usage: finish.totalUsage,
  });
}
