import type { GatewayResult, GatewayToolCall } from "../../routing/gateway.types.js";
import { type OpenAiFinishReason, toFinishReason } from "./finish-reason.js";
import { type OpenAiUsage, toOpenAiUsage } from "./usage.js";

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
  usage: OpenAiUsage;
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
    usage: toOpenAiUsage(result.usage),
  };
}

function toToolCall(call: GatewayToolCall): ChatCompletionToolCall {
  return {
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.input) },
  };
}
