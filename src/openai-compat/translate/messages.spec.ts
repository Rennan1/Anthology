import { GatewayError } from "../../routing/gateway-error.js";
import { buildChatCompletion } from "../response/build-chat-completion.js";
import { translateMessages } from "./messages.js";

function errorOf(messages: unknown[]): GatewayError {
  try {
    translateMessages(messages);
  } catch (err) {
    if (err instanceof GatewayError) return err;
    throw err;
  }
  throw new Error("expected GatewayError");
}

const call = (id: string, name: string, args: string) => ({
  id,
  type: "function",
  function: { name, arguments: args },
});

describe("translateMessages: system, developer and text (SPEC-005 table)", () => {
  it("maps system and developer strings to system messages", () => {
    expect(
      translateMessages([
        { role: "system", content: "seja breve" },
        { role: "developer", content: "responda em pt-BR" },
      ]),
    ).toEqual([
      { role: "system", content: "seja breve" },
      { role: "system", content: "responda em pt-BR" },
    ]);
  });

  it("joins system text parts with a blank line", () => {
    const parts = [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ];

    expect(translateMessages([{ role: "system", content: parts }])).toEqual([
      { role: "system", content: "a\n\nb" },
    ]);
  });

  it("keeps a system message in the middle of the conversation where it was", () => {
    const out = translateMessages([
      { role: "user", content: "oi" },
      { role: "system", content: "agora formal" },
      { role: "user", content: "e então" },
    ]);

    expect(out.map((m) => m.role)).toEqual(["user", "system", "user"]);
  });

  it("maps user strings and text parts, and ignores the name field", () => {
    expect(
      translateMessages([
        { role: "user", name: "ana", content: "oi" },
        { role: "user", content: [{ type: "text", text: "olá" }] },
      ]),
    ).toEqual([
      { role: "user", content: "oi" },
      { role: "user", content: [{ type: "text", text: "olá" }] },
    ]);
  });
});

describe("translateMessages: images (criterion 4)", () => {
  const user = (url: string) => [
    { role: "user", content: [{ type: "image_url", image_url: { url, detail: "low" } }] },
  ];

  it("turns an https URL into a URL object", () => {
    const [message] = translateMessages(user("https://exemplo.test/gato.png"));

    expect(message).toEqual({
      role: "user",
      content: [{ type: "image", image: new URL("https://exemplo.test/gato.png") }],
    });
  });

  it("turns a base64 data URL into bytes plus the media type", () => {
    const [message] = translateMessages(user("data:image/png;base64,iVBORw0KGgo="));

    const part = (message as { content: { image: Uint8Array; mediaType: string }[] }).content[0];
    expect(part?.mediaType).toBe("image/png");
    expect(Buffer.from(part?.image ?? []).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("rejects a URL scheme other than http, https or data", () => {
    const err = errorOf(user("file:///etc/passwd"));

    expect(err).toMatchObject({
      code: "invalid_request",
      param: "messages[0].content[0].image_url.url",
    });
  });

  it("rejects audio and file parts as unsupported_parameter, naming the part", () => {
    const audio = errorOf([
      {
        role: "user",
        content: [
          { type: "text", text: "x" },
          { type: "input_audio", input_audio: { data: "AAA", format: "wav" } },
        ],
      },
    ]);
    const file = errorOf([{ role: "user", content: [{ type: "file", file: { file_id: "f" } }] }]);

    expect(audio).toMatchObject({ code: "unsupported_parameter", param: "messages[0].content[1]" });
    expect(file).toMatchObject({ code: "unsupported_parameter", param: "messages[0].content[0]" });
  });
});

describe("translateMessages: assistant and tool calling", () => {
  it("maps assistant text to a text part, skipping empty text", () => {
    expect(
      translateMessages([
        { role: "assistant", content: "oi" },
        { role: "assistant", content: "", tool_calls: [call("c1", "f", "{}")] },
      ]),
    ).toEqual([
      { role: "assistant", content: [{ type: "text", text: "oi" }] },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "f", input: {} }],
      },
    ]);
  });

  it("maps tool_calls with null content to tool-call parts with parsed input", () => {
    const [message] = translateMessages([
      {
        role: "assistant",
        content: null,
        tool_calls: [call("c1", "clima", '{"cidade":"Recife"}')],
      },
    ]);

    expect(message).toEqual({
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "c1", toolName: "clima", input: { cidade: "Recife" } },
      ],
    });
  });

  it("accepts an assistant tool-call message with no content key at all", () => {
    // The Python SDK sends it so (model_dump(exclude_none=True) drops `content: null`).
    const [message] = translateMessages([
      { role: "assistant", tool_calls: [call("c1", "f", "{}")] },
    ]);

    expect(message).toEqual({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "c1", toolName: "f", input: {} }],
    });
  });

  it("treats empty arguments as an empty object", () => {
    const [message] = translateMessages([
      { role: "assistant", content: null, tool_calls: [call("c1", "f", "")] },
    ]);

    expect(JSON.stringify(message)).toContain('"input":{}');
  });

  it("rejects non-JSON arguments with the exact path (criterion 3)", () => {
    const err = errorOf([
      { role: "user", content: "oi" },
      { role: "user", content: "oi" },
      { role: "assistant", content: null, tool_calls: [call("c1", "f", "{nao-json")] },
    ]);

    expect(err).toMatchObject({
      code: "invalid_request",
      param: "messages[2].tool_calls[0].function.arguments",
    });
  });

  it("maps a tool message to a tool-result named after the earlier tool call", () => {
    const out = translateMessages([
      { role: "assistant", content: null, tool_calls: [call("c1", "clima", "{}")] },
      { role: "tool", tool_call_id: "c1", content: "28 graus" },
    ]);

    expect(out[1]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "clima",
          output: { type: "text", value: "28 graus" },
        },
      ],
    });
  });

  it("concatenates a tool message made of text parts", () => {
    const out = translateMessages([
      { role: "assistant", content: null, tool_calls: [call("c1", "f", "{}")] },
      {
        role: "tool",
        tool_call_id: "c1",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      },
    ]);

    expect(JSON.stringify(out[1])).toContain('"value":"ab"');
  });

  it("rejects a tool message with no matching tool call (criterion 2)", () => {
    const err = errorOf([
      { role: "assistant", content: null, tool_calls: [call("c1", "f", "{}")] },
      { role: "tool", tool_call_id: "outro", content: "x" },
    ]);

    expect(err).toMatchObject({ code: "invalid_request", param: "messages[1].tool_call_id" });
    expect(err.message).toContain("tool_call_id");
  });

  it("does not match a tool message against a call that comes after it", () => {
    const err = errorOf([
      { role: "tool", tool_call_id: "c1", content: "x" },
      { role: "assistant", content: null, tool_calls: [call("c1", "f", "{}")] },
    ]);

    expect(err.param).toBe("messages[0].tool_call_id");
  });
});

describe("translateMessages: shape errors", () => {
  it.each([
    ["a numeric user content", [{ role: "user", content: 42 }], "messages[0].content"],
    [
      "a user part without type",
      [{ role: "user", content: [{ text: "x" }] }],
      "messages[0].content[0].type",
    ],
    [
      "a text part without text",
      [{ role: "user", content: [{ type: "text" }] }],
      "messages[0].content[0].text",
    ],
    [
      "a tool call without a function name",
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "c", type: "function", function: { arguments: "{}" } }],
        },
      ],
      "messages[0].tool_calls[0].function.name",
    ],
    [
      "a tool message without tool_call_id",
      [{ role: "tool", content: "x" }],
      "messages[0].tool_call_id",
    ],
  ])("rejects %s with invalid_request and the path", (_name, messages, param) => {
    expect(errorOf(messages)).toMatchObject({ code: "invalid_request", param });
  });
});

describe("translateMessages: a 4-turn conversation with parallel tool calls (criterion 1)", () => {
  const args1 = '{"cidade":"Recife"}';
  const args2 = '{"cidade":"Natal","unidade":"C"}';
  const conversation = [
    { role: "system", content: "assistente de clima" },
    { role: "user", content: "clima em Recife e Natal?" },
    {
      role: "assistant",
      content: null,
      tool_calls: [call("call_a", "clima", args1), call("call_b", "clima_unidade", args2)],
    },
    { role: "tool", tool_call_id: "call_a", content: "28" },
    { role: "tool", tool_call_id: "call_b", content: "30" },
    { role: "assistant", content: "Recife 28, Natal 30" },
    { role: "user", content: "e amanhã?" },
  ];

  it("resolves each toolName from the matching call", () => {
    const out = translateMessages(conversation);

    const names = out
      .filter((m) => m.role === "tool")
      .flatMap((m) => (m.content as { toolName: string }[]).map((part) => part.toolName));
    expect(names).toEqual(["clima", "clima_unidade"]);
  });

  it("round-trips id, name and arguments through the AI SDK shape and back to OpenAI", () => {
    const out = translateMessages(conversation);
    const assistant = out[2] as {
      content: { toolCallId: string; toolName: string; input: unknown }[];
    };

    const completion = buildChatCompletion({
      id: "chatcmpl-x",
      created: 1,
      requestedModel: "code",
      result: {
        text: "",
        toolCalls: assistant.content.map((part) => ({
          id: part.toolCallId,
          name: part.toolName,
          input: part.input,
        })),
        finishReason: "tool-calls",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        route: "code",
        routedBy: "client",
        modelKey: "m",
        attempts: 1,
      },
    });

    expect(completion.choices[0].message.tool_calls).toEqual([
      call("call_a", "clima", args1),
      call("call_b", "clima_unidade", args2),
    ]);
  });
});
