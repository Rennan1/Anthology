import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type OpenAI from "openai";
import { httpError } from "../support/scripted-model.js";
import {
  scriptedStreamModel,
  textStream,
  toolStream,
  wholeToolCallStream,
} from "../support/scripted-stream-model.js";
import { startRealStack } from "./real-stack.js";

const KEY = "sk-test";
const hello = [{ role: "user" as const, content: "oi" }];
const tools = [
  {
    type: "function" as const,
    function: { name: "clima", parameters: { type: "object", properties: {} } },
  },
];

const sonnet = scriptedStreamModel(
  textStream("Olá", " mundo"), // 0: exact sequence
  textStream("a"), // 1: usage
  httpError(503), // 2: fails before the first part, mini answers
  toolStream("call_1", "clima", ['{"cidade":', '"Recife"}']), // 3: tool input in pieces
  wholeToolCallStream("call_2", "clima", { cidade: "Natal" }), // 4: whole tool call
  { parts: textStream("um", "dois").slice(0, 4), thenHang: true }, // 5: client leaves
  { parts: textStream("a", "b", "c").slice(0, 5), thenFail: httpError(500) }, // 6: fails after commit
);
const mini = scriptedStreamModel(textStream("do fallback"));

let app: NestExpressApplication;
let client: OpenAI;
let baseUrl: string;

beforeAll(async () => {
  ({ app, client } = await startRealStack({ sonnet, flash: scriptedStreamModel(), mini }));
  baseUrl = client.baseURL.replace(/\/v1$/, "");
});
afterAll(async () => {
  await app.close();
});

async function raw(body: object = {}) {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "code", messages: hello, stream: true, ...body }),
  });
  const text = await response.text();
  const events = text.split("\n\n").filter(Boolean);
  return { response, text, events };
}

const frame = (event: string | undefined) => JSON.parse((event ?? "").replace(/^data: /, ""));

describe("SPEC-006 through the real stack (translation, routing, AI SDK streamText)", () => {
  it("criterion 1: the exact sequence role, deltas, finish_reason, [DONE]", async () => {
    const { events } = await raw();

    expect(events.slice(0, -1).map((event) => frame(event).choices[0].delta)).toEqual([
      { role: "assistant", content: "" },
      { content: "Olá" },
      { content: " mundo" },
      {},
    ]);
    expect(frame(events.at(-2)).choices[0].finish_reason).toBe("stop");
    expect(events.at(-1)).toBe("data: [DONE]");
  });

  it("criterion 4: usage comes from the provider's finish part", async () => {
    const { events } = await raw({ stream_options: { include_usage: true } });

    expect(frame(events.at(-2))).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
  });

  it("SPEC-003 criteria 6 and 8: a 503 before the first part falls back, with no byte of the failed candidate", async () => {
    const { response, text, events } = await raw();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-anthology-model")).toBe("mini");
    expect(response.headers.get("x-anthology-attempts")).toBe("2");
    expect(events.slice(1, -2).map((event) => frame(event).choices[0].delta.content)).toEqual([
      "do fallback",
    ]);
    expect(text).not.toContain("error");
    expect(mini.doStreamCalls).toHaveLength(1);
  });

  it("criterion 2: tool input that arrives in pieces is rebuilt by the openai SDK", async () => {
    const completion = await client.chat.completions
      .stream({ model: "code", messages: hello, tools })
      .finalChatCompletion();

    const call = completion.choices[0]?.message.tool_calls?.[0];
    expect(call).toMatchObject({ id: "call_1", type: "function" });
    expect(call && "function" in call && JSON.parse(call.function.arguments)).toEqual({
      cidade: "Recife",
    });
    expect(completion.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("criterion 3: a tool call the provider announces whole still reaches the client complete", async () => {
    const completion = await client.chat.completions
      .stream({ model: "code", messages: hello, tools })
      .finalChatCompletion();

    const call = completion.choices[0]?.message.tool_calls?.[0];
    expect(call).toMatchObject({ id: "call_2", type: "function" });
    expect(call && "function" in call && JSON.parse(call.function.arguments)).toEqual({
      cidade: "Natal",
    });
  });

  it("criterion 6: the provider call is aborted when the client leaves after the second delta", async () => {
    const stream = await client.chat.completions.create({
      model: "code",
      messages: hello,
      stream: true,
    });
    let deltas = 0;
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta.content) deltas += 1;
      if (deltas === 2) stream.controller.abort();
    }

    await new Promise<void>((resolve) => {
      const wait = setInterval(() => {
        if (sonnet.doStreamCalls[5]?.abortSignal?.aborted) {
          clearInterval(wait);
          resolve();
        }
      }, 5);
    });
    expect(sonnet.doStreamCalls[5]?.abortSignal?.aborted).toBe(true);
    expect(mini.doStreamCalls).toHaveLength(1); // the fallback was not tried
  });

  it("criterion 5: a failure after the commit ends in the error event, never [DONE], and no fallback", async () => {
    const { text, events } = await raw();

    expect(events.slice(1, 4).map((event) => frame(event).choices[0].delta.content)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(text).not.toContain("[DONE]");
    expect(frame(events.at(-1))).toEqual({
      error: {
        message: "upstream interrompeu a geração",
        type: "api_error",
        code: "upstream_stream_error",
      },
    });
    expect(mini.doStreamCalls).toHaveLength(1);
  });
});
