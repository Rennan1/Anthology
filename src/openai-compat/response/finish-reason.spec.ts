import { describe, expect, it } from "@jest/globals";
import type { GatewayFinishReason } from "../../routing/gateway.types.js";
import { toFinishReason } from "./finish-reason.js";

describe("toFinishReason", () => {
  const rows: ReadonlyArray<[GatewayFinishReason, string]> = [
    ["stop", "stop"],
    ["length", "length"],
    ["tool-calls", "tool_calls"],
    ["content-filter", "content_filter"],
    ["error", "stop"],
    ["other", "stop"],
    ["unknown", "stop"],
  ];

  it.each(rows)("maps %s to %s", (input, expected) => {
    expect(toFinishReason(input)).toBe(expected);
  });
});
