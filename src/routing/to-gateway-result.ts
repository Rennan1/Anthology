import type { FinishReason, LanguageModelUsage } from "ai";
import type { GatewayFinishReason, GatewayResult } from "./gateway.types.js";

/** The part of an AI SDK result the gateway reads. */
export interface GenerationOutput {
  readonly text: string;
  readonly toolCalls: readonly { toolCallId: string; toolName: string; input: unknown }[];
  readonly finishReason: FinishReason;
  readonly rawFinishReason: string | undefined;
  readonly usage: LanguageModelUsage;
}

export type ResultParts = Pick<
  GatewayResult,
  "text" | "toolCalls" | "finishReason" | "usage" | "usageMissing" | "finishReasonRaw"
>;

function toFinishReason(reason: FinishReason): GatewayFinishReason {
  // `interrupted` (AI SDK 7: stream ended without a completion signal) has no OpenAI counterpart.
  return reason === "interrupted" ? "other" : reason;
}

// The mapping to the OpenAI vocabulary loses the original here, so the log keeps it (SPEC-005).
const LOSSY_FINISH_REASONS: readonly FinishReason[] = ["error", "other", "interrupted"];

function toUsage(usage: LanguageModelUsage): GatewayResult["usage"] {
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  const cached = usage.inputTokenDetails.cacheReadTokens;
  const reasoning = usage.outputTokenDetails.reasoningTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
    ...(cached !== undefined && { cachedPromptTokens: cached }),
    ...(reasoning !== undefined && { reasoningTokens: reasoning }),
  };
}

export function toResultParts(output: GenerationOutput): ResultParts {
  const usageMissing =
    output.usage.inputTokens === undefined && output.usage.outputTokens === undefined;
  return {
    text: output.text,
    toolCalls: output.toolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      input: call.input,
    })),
    finishReason: toFinishReason(output.finishReason),
    usage: toUsage(output.usage),
    ...(usageMissing && { usageMissing: true as const }),
    ...(LOSSY_FINISH_REASONS.includes(output.finishReason) &&
      output.rawFinishReason !== undefined && { finishReasonRaw: output.rawFinishReason }),
  };
}
