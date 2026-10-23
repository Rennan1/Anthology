import type { FinishReason, LanguageModelUsage } from "ai";
import type { GatewayFinishReason, GatewayResult } from "./gateway.types.js";

/** The part of an AI SDK result the gateway reads. */
export interface GenerationOutput {
  readonly text: string;
  readonly toolCalls: readonly { toolCallId: string; toolName: string; input: unknown }[];
  readonly finishReason: FinishReason;
  readonly usage: LanguageModelUsage;
}

export type ResultParts = Pick<GatewayResult, "text" | "toolCalls" | "finishReason" | "usage">;

function toFinishReason(reason: FinishReason): GatewayFinishReason {
  // `interrupted` (AI SDK 7: stream ended without a completion signal) has no OpenAI counterpart.
  return reason === "interrupted" ? "other" : reason;
}

export function toResultParts(output: GenerationOutput): ResultParts {
  const promptTokens = output.usage.inputTokens ?? 0;
  const completionTokens = output.usage.outputTokens ?? 0;
  return {
    text: output.text,
    toolCalls: output.toolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      input: call.input,
    })),
    finishReason: toFinishReason(output.finishReason),
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: output.usage.totalTokens ?? promptTokens + completionTokens,
    },
  };
}
