import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type Usage = GenerateResult["usage"];

export const usage = (input = 12, output = 3): Usage => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

export function textReply(
  text: string,
  finish: GenerateResult["finishReason"]["unified"] = "stop",
) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: finish, raw: finish },
    usage: usage(),
    warnings: [],
  } satisfies GenerateResult;
}

export function toolCallReply(id: string, name: string, input: unknown) {
  return {
    content: [
      { type: "tool-call" as const, toolCallId: id, toolName: name, input: JSON.stringify(input) },
    ],
    finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
    usage: usage(),
    warnings: [],
  } satisfies GenerateResult;
}

/** `isRetryable: false` keeps the AI SDK from sleeping before the gateway's own fallback. */
export function httpError(statusCode: number): APICallError {
  return new APICallError({
    message: `upstream ${statusCode}`,
    url: "https://upstream.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });
}

/** A transport failure as the AI SDK reports it: no status, flagged retryable. */
export function networkError(): APICallError {
  return new APICallError({
    message: "Cannot connect to API: connect ECONNREFUSED",
    url: "https://upstream.test/v1/chat/completions",
    requestBodyValues: {},
    isRetryable: true,
  });
}

/** Never answers; rejects the way the SDK does when its abort signal fires. */
export const HANG = Symbol("hang");

export type Step = ReturnType<typeof textReply> | GenerateResult | Error | typeof HANG;

/** A mock model that plays `steps` in order; `doGenerateCalls` counts and records every call. */
export function scriptedModel(...steps: Step[]): MockLanguageModelV4 {
  const queue = [...steps];
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const step = queue.shift();
      if (step === undefined) throw new Error("scripted model: script exhausted");
      if (step === HANG) {
        await new Promise<never>((_, reject) => {
          options.abortSignal?.addEventListener("abort", () =>
            reject(options.abortSignal?.reason ?? new Error("aborted")),
          );
        });
      }
      if (step instanceof Error) throw step;
      return step as GenerateResult;
    },
  });
}
