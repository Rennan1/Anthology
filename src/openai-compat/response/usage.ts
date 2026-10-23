import type { GatewayUsage } from "../../routing/gateway.types.js";

export interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
}

/** SPEC-005: the details only appear when the provider reported them. */
export function toOpenAiUsage(usage: GatewayUsage): OpenAiUsage {
  return {
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    ...(usage.cachedPromptTokens !== undefined && {
      prompt_tokens_details: { cached_tokens: usage.cachedPromptTokens },
    }),
    ...(usage.reasoningTokens !== undefined && {
      completion_tokens_details: { reasoning_tokens: usage.reasoningTokens },
    }),
  };
}
