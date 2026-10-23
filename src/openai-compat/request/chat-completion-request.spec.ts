import { GatewayError } from "../../routing/gateway-error.js";
import { parseChatCompletionRequest } from "./chat-completion-request.js";

const minimal = { model: "code", messages: [{ role: "user", content: "oi" }] };

function errorOf(body: unknown): GatewayError {
  try {
    parseChatCompletionRequest(body, undefined);
  } catch (err) {
    if (err instanceof GatewayError) return err;
    throw err;
  }
  throw new Error("expected GatewayError, but parsing succeeded");
}

describe("parseChatCompletionRequest", () => {
  it("translates a minimal body into a GatewayRequest with defaults", () => {
    const parsed = parseChatCompletionRequest(minimal, undefined);

    expect(parsed).toEqual({
      request: {
        model: "code",
        continuationRoute: undefined,
        messages: [{ role: "user", content: "oi" }],
        params: {},
        tools: undefined,
        toolChoice: undefined,
        parallelToolCalls: undefined,
        responseFormat: undefined,
        endUser: undefined,
      },
      stream: false,
      includeUsage: false,
    });
  });

  describe("invalid_request", () => {
    it.each([
      ["a non-object body", "texto", undefined],
      ["an array body", [], undefined],
      ["a missing model", { messages: minimal.messages }, "model"],
      ["an empty model", { ...minimal, model: "" }, "model"],
      ["a missing messages", { model: "code" }, "messages"],
      ["an empty messages", { model: "code", messages: [] }, "messages"],
      [
        "an invalid role",
        { model: "code", messages: [{ role: "user", content: "a" }, { role: "robot" }] },
        "messages[1].role",
      ],
      ["a non-object message", { model: "code", messages: ["oi"] }, "messages[0]"],
    ])("rejects %s", (_name, body, param) => {
      const err = errorOf(body);

      expect(err.code).toBe("invalid_request");
      expect(err.param).toBe(param ?? null);
    });
  });

  describe("translation errors (SPEC-005) surface as 400 with the field path", () => {
    it("rejects a malformed message", () => {
      const err = errorOf({ model: "code", messages: [{ role: "user", content: 42 }] });

      expect(err).toMatchObject({ code: "invalid_request", param: "messages[0].content" });
    });

    it("rejects a tool message with no matching call", () => {
      const err = errorOf({
        model: "code",
        messages: [{ role: "tool", tool_call_id: "x", content: "ok" }],
      });

      expect(err).toMatchObject({ code: "invalid_request", param: "messages[0].tool_call_id" });
    });

    it("rejects a non-function tool", () => {
      const err = errorOf({ ...minimal, tools: [{ type: "custom" }] });

      expect(err).toMatchObject({ code: "unsupported_parameter", param: "tools[0].type" });
    });

    it("rejects a response_format json_schema without its schema object", () => {
      const err = errorOf({ ...minimal, response_format: { type: "json_schema" } });

      expect(err).toMatchObject({ code: "invalid_request", param: "response_format.json_schema" });
    });
  });

  describe("unsupported_parameter", () => {
    it.each([
      ["n", 2],
      ["logprobs", true],
      ["top_logprobs", 3],
      ["logit_bias", { "50256": -100 }],
      ["functions", [{ name: "f" }]],
      ["function_call", "auto"],
      ["audio", { voice: "alloy", format: "mp3" }],
      ["prediction", { type: "content", content: "x" }],
      ["modalities", ["text", "audio"]],
    ])("rejects %s with param naming the field", (field, value) => {
      const err = errorOf({ ...minimal, [field]: value });

      expect(err.code).toBe("unsupported_parameter");
      expect(err.param).toBe(field);
    });

    it("lets n=1, logprobs=false and text-only modalities through", () => {
      expect(() =>
        parseChatCompletionRequest(
          { ...minimal, n: 1, logprobs: false, modalities: ["text"] },
          undefined,
        ),
      ).not.toThrow();
    });

    it("treats null as absent for every known parameter", () => {
      const nulls = Object.fromEntries(
        [
          "n",
          "logprobs",
          "top_logprobs",
          "logit_bias",
          "functions",
          "function_call",
          "audio",
          "prediction",
          "modalities",
        ].map((field) => [field, null]),
      );

      expect(() => parseChatCompletionRequest({ ...minimal, ...nulls }, undefined)).not.toThrow();
    });

    it("ignores unknown fields without changing the result (SPEC-001 criterion 4)", () => {
      expect(parseChatCompletionRequest({ ...minimal, foo: 1 }, undefined)).toEqual(
        parseChatCompletionRequest(minimal, undefined),
      );
    });
  });

  describe("pass-through", () => {
    it("maps sampling parameters to camelCase params", () => {
      const { request } = parseChatCompletionRequest(
        {
          ...minimal,
          temperature: 0.7,
          top_p: 0.9,
          seed: 42,
          presence_penalty: 0.5,
          frequency_penalty: -0.5,
        },
        undefined,
      );

      expect(request.params).toEqual({
        temperature: 0.7,
        topP: 0.9,
        seed: 42,
        presencePenalty: 0.5,
        frequencyPenalty: -0.5,
      });
    });

    it("prefers max_completion_tokens over max_tokens", () => {
      const both = parseChatCompletionRequest(
        { ...minimal, max_tokens: 10, max_completion_tokens: 20 },
        undefined,
      );
      const legacy = parseChatCompletionRequest({ ...minimal, max_tokens: 10 }, undefined);

      expect(both.request.params.maxOutputTokens).toBe(20);
      expect(legacy.request.params.maxOutputTokens).toBe(10);
    });

    it("normalizes stop to an array", () => {
      const single = parseChatCompletionRequest({ ...minimal, stop: "END" }, undefined);
      const many = parseChatCompletionRequest({ ...minimal, stop: ["a", "b"] }, undefined);

      expect(single.request.params.stop).toEqual(["END"]);
      expect(many.request.params.stop).toEqual(["a", "b"]);
    });

    it("translates tools, tool_choice and response_format (SPEC-005) and forwards the rest", () => {
      const tools = [{ type: "function", function: { name: "f", parameters: {} } }];
      const responseFormat = { type: "json_object" };
      const { request } = parseChatCompletionRequest(
        {
          ...minimal,
          tools,
          tool_choice: "auto",
          parallel_tool_calls: false,
          response_format: responseFormat,
          user: "u-1",
        },
        undefined,
      );

      expect(Object.keys(request.tools ?? {})).toEqual(["f"]);
      expect(request.toolChoice).toBe("auto");
      expect(request.parallelToolCalls).toBe(false);
      expect(request.responseFormat).toEqual({ type: "json_object" });
      expect(request.endUser).toBe("u-1");
    });

    it("exposes stream and include_usage, defaulting both to false", () => {
      const on = parseChatCompletionRequest(
        { ...minimal, stream: true, stream_options: { include_usage: true } },
        undefined,
      );
      const off = parseChatCompletionRequest(
        { ...minimal, stream: null, stream_options: null },
        undefined,
      );

      expect(on).toMatchObject({ stream: true, includeUsage: true });
      expect(off).toMatchObject({ stream: false, includeUsage: false });
    });

    it("copies continuationRoute into the request", () => {
      const { request } = parseChatCompletionRequest(minimal, "code");

      expect(request.continuationRoute).toBe("code");
    });

    it("treats null optional parameters as absent", () => {
      const { request } = parseChatCompletionRequest(
        { ...minimal, temperature: null, stop: null, max_tokens: null, tools: null, user: null },
        undefined,
      );

      expect(request.params).toEqual({});
      expect(request.tools).toBeUndefined();
      expect(request.endUser).toBeUndefined();
    });
  });

  describe("ranges", () => {
    it.each([
      ["temperature", 2.1],
      ["temperature", -0.1],
      ["temperature", "hot"],
      ["top_p", 1.5],
      ["presence_penalty", 2.5],
      ["frequency_penalty", -2.5],
      ["seed", 1.5],
      ["max_tokens", 0],
      ["max_completion_tokens", -1],
      ["max_completion_tokens", 1.5],
      ["stop", ["a", "b", "c", "d", "e"]],
      ["stop", 7],
      ["stream", "yes"],
      ["parallel_tool_calls", "no"],
      ["tools", "f"],
      ["response_format", { type: "xml" }],
      ["user", 12],
      ["stream_options", { include_usage: "x" }],
    ])("rejects %s=%j naming the field", (field, value) => {
      const err = errorOf({ ...minimal, [field]: value });

      expect(err.code).toBe("invalid_request");
      expect(err.param?.split(".")[0]).toBe(field);
    });
  });
});
