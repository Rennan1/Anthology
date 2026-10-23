import { MockLanguageModelV4 } from "ai/test";
import { HANG, usage } from "./scripted-model.js";

type Doer = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doStream"];
type StreamResult = Awaited<ReturnType<Extract<Doer, (...args: never[]) => unknown>>>;
export type UpstreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const finishPart = (unified: "stop" | "tool-calls" | "length" = "stop"): UpstreamPart => ({
  type: "finish",
  finishReason: { unified, raw: unified },
  usage: usage(),
});

/** Upstream parts of a plain text answer, one delta per argument. */
export function textStream(...deltas: string[]): UpstreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    ...deltas.map((delta): UpstreamPart => ({ type: "text-delta", id: "t", delta })),
    { type: "text-end", id: "t" },
    finishPart(),
  ];
}

/** A tool call whose JSON input arrives in pieces (`tool-input-*`), then the complete call. */
export function toolStream(id: string, toolName: string, inputPieces: string[]): UpstreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "tool-input-start", id, toolName },
    ...inputPieces.map((delta): UpstreamPart => ({ type: "tool-input-delta", id, delta })),
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName, input: inputPieces.join("") },
    finishPart("tool-calls"),
  ];
}

/** A tool call the provider announces whole, with no `tool-input-*` parts. */
export function wholeToolCallStream(id: string, toolName: string, input: unknown): UpstreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
    finishPart("tool-calls"),
  ];
}

export interface Pacing {
  /** Parts emitted before the pause, then the pause, then the rest. */
  readonly pauseAfter: number;
  readonly pauseMs: number;
}

export interface StreamPlan {
  readonly parts: readonly UpstreamPart[];
  readonly pacing?: Pacing;
  /** After the parts, the provider stream fails with this error instead of closing. */
  readonly thenFail?: Error;
  /** After the parts, the stream stays open until the call is aborted. */
  readonly thenHang?: true;
}

export type StreamStep = readonly UpstreamPart[] | StreamPlan | Error | typeof HANG;

function toPlan(step: readonly UpstreamPart[] | StreamPlan): StreamPlan {
  return "parts" in step ? step : { parts: step };
}

function open(plan: StreamPlan, signal: AbortSignal | undefined): ReadableStream<UpstreamPart> {
  let index = 0;
  return new ReadableStream<UpstreamPart>({
    async pull(controller) {
      if (plan.pacing && index === plan.pacing.pauseAfter) {
        await new Promise((resolve) => setTimeout(resolve, plan.pacing?.pauseMs));
      }
      const part = plan.parts[index];
      if (part !== undefined) {
        index += 1;
        controller.enqueue(part);
        return;
      }
      if (plan.thenFail) {
        controller.enqueue({ type: "error", error: plan.thenFail });
        controller.close();
        return;
      }
      if (plan.thenHang) {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
        controller.error(signal?.reason ?? new Error("aborted"));
        return;
      }
      controller.close();
    },
  });
}

/** A mock model that plays `steps` in order, one per doStream call; `doStreamCalls` records them. */
export function scriptedStreamModel(...steps: StreamStep[]): MockLanguageModelV4 {
  const queue = [...steps];
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const step = queue.shift();
      if (step === undefined) throw new Error("scripted stream model: script exhausted");
      if (step === HANG) {
        await new Promise<never>((_, reject) => {
          options.abortSignal?.addEventListener("abort", () =>
            reject(options.abortSignal?.reason ?? new Error("aborted")),
          );
        });
      }
      if (step instanceof Error) throw step;
      return {
        stream: open(toPlan(step as readonly UpstreamPart[] | StreamPlan), options.abortSignal),
      };
    },
  });
}
