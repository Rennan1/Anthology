import { describe, expect, it } from "@jest/globals";
import type { GatewayResult } from "../../routing/gateway.types.js";
import { buildChatCompletion } from "./build-chat-completion.js";

const baseResult: GatewayResult = {
  text: "hello",
  toolCalls: [],
  finishReason: "stop",
  usage: { promptTokens: 120, completionTokens: 48, totalTokens: 168 },
  route: "code",
  routedBy: "client",
  modelKey: "claude-sonnet",
  attempts: 1,
};

const build = (result: Partial<GatewayResult> = {}, requestedModel = "code") =>
  buildChatCompletion({
    id: "chatcmpl-abc",
    created: 1792627260,
    requestedModel,
    result: { ...baseResult, ...result },
  });

describe("buildChatCompletion", () => {
  it("builds the exact SPEC-001 shape for a plain text answer", () => {
    expect(build()).toEqual({
      id: "chatcmpl-abc",
      object: "chat.completion",
      created: 1792627260,
      model: "code",
      choices: [
        { index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 48, total_tokens: 168 },
    });
  });

  it("echoes the requested model, never the model that served", () => {
    expect(build({ modelKey: "other-model", route: "chat" }, "auto").model).toBe("auto");
  });

  it("uses the id and created it was given", () => {
    const completion = buildChatCompletion({
      id: "chatcmpl-xyz",
      created: 42,
      requestedModel: "code",
      result: baseResult,
    });
    expect([completion.id, completion.created]).toEqual(["chatcmpl-xyz", 42]);
  });

  it("adds cached and reasoning token details only when the provider reported them", () => {
    const detailed = build({
      usage: {
        promptTokens: 100,
        completionTokens: 30,
        totalTokens: 130,
        cachedPromptTokens: 40,
        reasoningTokens: 10,
      },
    });

    expect(detailed.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 30,
      total_tokens: 130,
      prompt_tokens_details: { cached_tokens: 40 },
      completion_tokens_details: { reasoning_tokens: 10 },
    });
    expect("prompt_tokens_details" in build().usage).toBe(false);
    expect("completion_tokens_details" in build().usage).toBe(false);
  });

  it("omits tool_calls when empty", () => {
    expect("tool_calls" in build().choices[0].message).toBe(false);
  });

  it("serializes tool calls with arguments as a JSON string", () => {
    const completion = build({
      text: "",
      finishReason: "tool-calls",
      toolCalls: [{ id: "call_1", name: "get_weather", input: { city: "Recife" } }],
    });
    expect(completion.choices[0].message.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Recife"}' },
      },
    ]);
    expect(completion.choices[0].finish_reason).toBe("tool_calls");
  });

  it("sets content to null when the answer is only tool_calls", () => {
    const completion = build({
      text: "",
      toolCalls: [{ id: "call_1", name: "f", input: {} }],
    });
    expect(completion.choices[0].message.content).toBeNull();
  });

  it("keeps text next to tool_calls when both exist", () => {
    const completion = build({
      text: "let me check",
      toolCalls: [{ id: "call_1", name: "f", input: {} }],
    });
    expect(completion.choices[0].message.content).toBe("let me check");
  });

  it("keeps empty text as an empty string when there are no tool_calls", () => {
    expect(build({ text: "" }).choices[0].message.content).toBe("");
  });

  it("maps the finish reason", () => {
    expect(build({ finishReason: "content-filter" }).choices[0].finish_reason).toBe(
      "content_filter",
    );
  });
});
