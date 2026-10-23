import type { GatewayFinishReason } from "../../routing/gateway.types.js";

export type OpenAiFinishReason = "stop" | "length" | "tool_calls" | "content_filter";

export const FINISH_REASON_MAP: Record<GatewayFinishReason, OpenAiFinishReason> = {
  stop: "stop",
  length: "length",
  "tool-calls": "tool_calls",
  "content-filter": "content_filter",
  error: "stop",
  other: "stop",
  unknown: "stop",
};

export function toFinishReason(reason: GatewayFinishReason): OpenAiFinishReason {
  return FINISH_REASON_MAP[reason];
}
