import type { GatewayResult, GatewayToolCall } from "../../routing/gateway.types.js";
import { type OpenAiFinishReason, toFinishReason } from "./finish-reason.js";

export interface ChatCompletionToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: [
    {
      index: 0;
      message: {
        role: "assistant";
        content: string | null;
        tool_calls?: ChatCompletionToolCall[];
      };
      finish_reason: OpenAiFinishReason;
    },
  ];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens: number };
    completion_tokens_details?: { reasoning_tokens: number };
  };
}

export interface BuildChatCompletionInput {
  id: string;
  created: number;
  requestedModel: string;
  result: GatewayResult;
}

export function buildChatCompletion({
  id,
  created,
  requestedModel,
  result,
}: BuildChatCompletionInput): ChatCompletion {
  const toolCalls = result.toolCalls.map(toToolCall);
  const hasToolCalls = toolCalls.length > 0;
  return {
    id,
    object: "chat.completion",
    created,
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: result.text === "" && hasToolCalls ? null : result.text,
          ...(hasToolCalls && { tool_calls: toolCalls }),
        },
        finish_reason: toFinishReason(result.finishReason),
      },
    ],
    usage: {
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      total_tokens: result.usage.totalTokens,
      // SPEC-005: the details only appear when the provider reported them.
      ...(result.usage.cachedPromptTokens !== undefined && {
        prompt_tokens_details: { cached_tokens: result.usage.cachedPromptTokens },
      }),
      ...(result.usage.reasoningTokens !== undefined && {
        completion_tokens_details: { reasoning_tokens: result.usage.reasoningTokens },
      }),
    },
  };
}

function toToolCall(call: GatewayToolCall): ChatCompletionToolCall {
  return {
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.input) },
  };
}
