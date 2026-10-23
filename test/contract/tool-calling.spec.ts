import type { NestExpressApplication } from "@nestjs/platform-express";
import type OpenAI from "openai";
import { scriptedModel, textReply, toolCallReply } from "../support/scripted-model.js";
import { startRealStack } from "./real-stack.js";

const tools = [
  {
    type: "function" as const,
    function: {
      name: "clima",
      description: "Clima atual",
      parameters: { type: "object", properties: { cidade: { type: "string" } } },
    },
  },
];
const hello: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "user", content: "clima?" }];

let app: NestExpressApplication;
let client: OpenAI;
const sonnet = scriptedModel(
  toolCallReply("call_1", "clima", { cidade: "Recife" }),
  textReply("28 graus"),
  textReply('{"cidade":"Natal"}'),
);

beforeAll(async () => {
  ({ app, client } = await startRealStack({
    sonnet,
    flash: scriptedModel(),
    mini: scriptedModel(),
  }));
});
afterAll(async () => {
  await app.close();
});

describe("SPEC-005 criterion 6: the tool call cycle through the real stack, with the openai SDK", () => {
  it("returns tool_calls, accepts the tool result, and the model sees the translated history", async () => {
    const first = await client.chat.completions.create({ model: "code", messages: hello, tools });
    const message = first.choices[0]?.message;
    const call = message?.tool_calls?.[0];

    expect(first.choices[0]?.finish_reason).toBe("tool_calls");
    expect(message?.content).toBeNull();
    expect(call).toMatchObject({ id: "call_1", type: "function" });
    expect(call && "function" in call && JSON.parse(call.function.arguments)).toEqual({
      cidade: "Recife",
    });

    const second = await client.chat.completions.create({
      model: "code",
      tools,
      messages: [
        ...hello,
        message as OpenAI.Chat.ChatCompletionAssistantMessageParam,
        { role: "tool", tool_call_id: "call_1", content: "28" },
      ],
    });

    expect(second.choices[0]?.message.content).toBe("28 graus");
    const prompt = sonnet.doGenerateCalls[1]?.prompt ?? [];
    expect(prompt.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(JSON.stringify(prompt[2])).toContain('"toolName":"clima"');
    expect(JSON.stringify(prompt[2])).toContain('"toolCallId":"call_1"');
  });

  it("hands the model the tool definitions the client sent", () => {
    const sent = sonnet.doGenerateCalls[0]?.tools?.[0];

    expect(sent).toMatchObject({ type: "function", name: "clima", description: "Clima atual" });
  });

  it("answers a json_schema request with the JSON text as a string", async () => {
    const completion = await client.chat.completions.create({
      model: "code",
      messages: hello,
      response_format: {
        type: "json_schema",
        json_schema: { name: "r", schema: { type: "object" }, strict: true },
      },
    });

    expect(completion.choices[0]?.message.content).toBe('{"cidade":"Natal"}');
    expect(sonnet.doGenerateCalls[2]?.responseFormat).toMatchObject({ type: "json", name: "r" });
  });

  it("rejects a tool message with no matching call, naming the field", async () => {
    await expect(
      client.chat.completions.create({
        model: "code",
        messages: [...hello, { role: "tool", tool_call_id: "ghost", content: "x" }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
      param: "messages[1].tool_call_id",
    });
  });
});
