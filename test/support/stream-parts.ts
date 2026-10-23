import type { TextStreamPart, ToolSet } from "ai";
import type { GatewayStream } from "../../src/routing/gateway.types.js";

export type Part = TextStreamPart<ToolSet>;

const usage = {
  inputTokens: 12,
  outputTokens: 3,
  totalTokens: 15,
  inputTokenDetails: { noCacheTokens: 12, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: 3, reasoningTokens: undefined },
};

export const finishPart = (reason: "stop" | "tool-calls" = "stop"): Part => ({
  type: "finish",
  finishReason: reason,
  rawFinishReason: reason,
  totalUsage: usage,
});

/** The AI SDK `fullStream` of a plain text answer. */
export function textParts(...deltas: string[]): Part[] {
  return [
    { type: "start" },
    { type: "start-step", request: {}, warnings: [] },
    { type: "text-start", id: "t" },
    ...deltas.map((text): Part => ({ type: "text-delta", id: "t", text })),
    { type: "text-end", id: "t" },
    finishPart(),
  ];
}

export function toolInputParts(id: string, toolName: string, pieces: string[]): Part[] {
  return [
    { type: "tool-input-start", id, toolName },
    ...pieces.map((delta): Part => ({ type: "tool-input-delta", id, delta })),
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName, input: JSON.parse(pieces.join("")) } as Part,
  ];
}

export async function* replay(parts: Iterable<Part>): AsyncGenerator<Part> {
  for (const part of parts) yield part;
}

/** A committed stream as the router hands it to the controller. */
export function streamOf(
  parts: AsyncIterable<Part>,
  overrides: Partial<GatewayStream> = {},
): GatewayStream {
  return {
    route: "code",
    routedBy: "client",
    modelKey: "sonnet",
    attempts: 1,
    parts,
    ...overrides,
  };
}
