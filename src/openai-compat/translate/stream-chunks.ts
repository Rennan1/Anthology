import type { TextStreamPart, ToolSet } from "ai";
import { toGatewayFinishReason, toGatewayUsage } from "../../routing/to-gateway-result.js";
import { type OpenAiFinishReason, toFinishReason } from "../response/finish-reason.js";
import { type OpenAiUsage, toOpenAiUsage } from "../response/usage.js";

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function: { name?: string; arguments?: string };
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: 0;
    delta: { role?: "assistant"; content?: string; tool_calls?: ToolCallDelta[] };
    finish_reason: OpenAiFinishReason | null;
  }[];
  usage?: OpenAiUsage;
}

export type ChunkEvent = { kind: "chunk"; chunk: ChatCompletionChunk } | { kind: "error" };

export interface ChunkMapper {
  map(part: TextStreamPart<ToolSet>): ChunkEvent[];
  /** True once the `finish` part arrived: the stream ended the way a model ends it. */
  readonly finished: boolean;
}

type Delta = ChatCompletionChunk["choices"][number]["delta"];

/**
 * SPEC-006 mapping of AI SDK stream parts to `chat.completion.chunk`s. One mapper per response:
 * it remembers whether the role chunk went out and which tool call got which index.
 * Parts the table calls silent (`start`, `start-step`, `text-start`, `reasoning-*`...) map to nothing.
 */
export function createChunkMapper(options: {
  id: string;
  created: number;
  model: string;
  includeUsage: boolean;
}): ChunkMapper {
  const { id, created, model, includeUsage } = options;
  const toolIndexes = new Map<string, number>();
  const streamedInputs = new Set<string>();
  let roleSent = false;
  let finished = false;

  const frame = (choices: ChatCompletionChunk["choices"], usage?: OpenAiUsage): ChunkEvent => ({
    kind: "chunk",
    chunk: {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices,
      ...(usage && { usage }),
    },
  });
  const delta = (value: Delta, finishReason: OpenAiFinishReason | null = null) =>
    frame([{ index: 0, delta: value, finish_reason: finishReason }]);
  /** The first content-bearing event is preceded by the role chunk. */
  const withRole = (events: ChunkEvent[]): ChunkEvent[] => {
    if (roleSent) return events;
    roleSent = true;
    return [delta({ role: "assistant", content: "" }), ...events];
  };
  const openToolCall = (callId: string): number => {
    const index = toolIndexes.size;
    toolIndexes.set(callId, index);
    return index;
  };

  return {
    get finished() {
      return finished;
    },
    map(part) {
      switch (part.type) {
        case "text-delta":
          return part.text === "" ? [] : withRole([delta({ content: part.text })]);
        case "tool-input-start": {
          streamedInputs.add(part.id);
          const index = openToolCall(part.id);
          const call: ToolCallDelta = {
            index,
            id: part.id,
            type: "function",
            function: { name: part.toolName, arguments: "" },
          };
          return withRole([delta({ tool_calls: [call] })]);
        }
        case "tool-input-delta": {
          const index = toolIndexes.get(part.id);
          if (index === undefined) return [];
          return withRole([
            delta({ tool_calls: [{ index, function: { arguments: part.delta } }] }),
          ]);
        }
        case "tool-call": {
          if (streamedInputs.has(part.toolCallId)) return [];
          const call: ToolCallDelta = {
            index: openToolCall(part.toolCallId),
            id: part.toolCallId,
            type: "function",
            function: { name: part.toolName, arguments: JSON.stringify(part.input) },
          };
          return withRole([delta({ tool_calls: [call] })]);
        }
        case "finish": {
          finished = true;
          const end = delta({}, toFinishReason(toGatewayFinishReason(part.finishReason)));
          const usageChunk = includeUsage
            ? [frame([], toOpenAiUsage(toGatewayUsage(part.totalUsage)))]
            : [];
          return withRole([end, ...usageChunk]);
        }
        case "error":
          return [{ kind: "error" }];
        default:
          return [];
      }
    },
  };
}
