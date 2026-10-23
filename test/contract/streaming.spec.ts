import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type OpenAI from "openai";
import { GatewayError } from "../../src/routing/gateway-error.js";
import {
  finishPart,
  type Part,
  replay,
  streamOf,
  textParts,
  toolInputParts,
} from "../support/stream-parts.js";
import { router, startGateway, VALID_KEY } from "./harness.js";

let app: NestExpressApplication;
let client: OpenAI;
let baseUrl: string;

beforeAll(async () => {
  ({ app, client, baseUrl } = await startGateway());
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => router.replyStream());

const hello = [{ role: "user" as const, content: "oi" }];
const tools = [
  {
    type: "function" as const,
    function: { name: "clima", parameters: { type: "object", properties: {} } },
  },
];

async function rawStream(body: object) {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${VALID_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "code", messages: hello, stream: true, ...body }),
  });
  return { response, text: await response.text() };
}

describe("SPEC-006 criterion 1: text only", () => {
  it("emits role, deltas, finish_reason and [DONE], in exactly that order, with the right headers", async () => {
    router.replyStream(streamOf(replay(textParts("Olá", " mundo"))));

    const { response, text } = await rawStream({});

    const events = text.split("\n\n").filter(Boolean);
    expect(events.at(-1)).toBe("data: [DONE]");
    const frames = events.slice(0, -1).map((event) => JSON.parse(event.replace(/^data: /, "")));
    expect(frames.map((f) => f.choices[0].delta)).toEqual([
      { role: "assistant", content: "" },
      { content: "Olá" },
      { content: " mundo" },
      {},
    ]);
    expect(frames.map((f) => f.choices[0].finish_reason)).toEqual([null, null, null, "stop"]);
    expect(new Set(frames.map((f) => `${f.id}|${f.created}|${f.model}`)).size).toBe(1);
    expect(frames[0].model).toBe("code");
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("x-anthology-model")).toBe("sonnet");
    expect(response.headers.get("x-anthology-attempts")).toBe("1");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("is understood by the openai SDK: the deltas concatenate to the model text", async () => {
    router.replyStream(streamOf(replay(textParts("Olá", " mundo"))));

    const stream = await client.chat.completions.create({
      model: "code",
      messages: hello,
      stream: true,
    });
    let content = "";
    let finish: string | null | undefined;
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta.content ?? "";
      finish = chunk.choices[0]?.finish_reason ?? finish;
    }

    expect(content).toBe("Olá mundo");
    expect(finish).toBe("stop");
  });
});

describe("SPEC-006 criteria 2 and 3: tool calls", () => {
  it("rebuilds two interleaved tool calls from the deltas, by index (criterion 2)", async () => {
    const a = toolInputParts("call_a", "clima", ['{"cida', 'de":"Recife"}']);
    const b = toolInputParts("call_b", "clima", ['{"cidade":', '"Natal"}']);
    const interleaved: Part[] = [
      { type: "start-step", request: {}, warnings: [] },
      a[0] as Part,
      b[0] as Part,
      a[1] as Part,
      b[1] as Part,
      a[2] as Part,
      b[2] as Part,
      a[3] as Part,
      b[3] as Part,
      a[4] as Part,
      b[4] as Part,
      finishPart("tool-calls"),
    ];
    router.replyStream(streamOf(replay(interleaved)));

    const completion = await client.chat.completions
      .stream({ model: "code", messages: hello, tools })
      .finalChatCompletion();

    const calls = completion.choices[0]?.message.tool_calls ?? [];
    expect(completion.choices[0]?.finish_reason).toBe("tool_calls");
    expect(calls.map((call) => call.id)).toEqual(["call_a", "call_b"]);
    expect(
      calls.map((call) => ("function" in call ? JSON.parse(call.function.arguments) : null)),
    ).toEqual([{ cidade: "Recife" }, { cidade: "Natal" }]);
  });

  it("sends a tool call that never streamed its input as one complete chunk (criterion 3)", async () => {
    const whole: Part[] = [
      { type: "start-step", request: {}, warnings: [] },
      {
        type: "tool-call",
        toolCallId: "call_w",
        toolName: "clima",
        input: { cidade: "Recife" },
      } as Part,
      finishPart("tool-calls"),
    ];
    router.replyStream(streamOf(replay(whole)));

    const { text } = await rawStream({ tools });

    const toolChunks = text
      .split("\n\n")
      .filter((event) => event.startsWith("data: {"))
      .map((event) => JSON.parse(event.replace(/^data: /, "")))
      .filter((frame) => frame.choices[0]?.delta?.tool_calls !== undefined);
    expect(toolChunks).toHaveLength(1);
    expect(toolChunks[0].choices[0].delta.tool_calls).toEqual([
      {
        index: 0,
        id: "call_w",
        type: "function",
        function: { name: "clima", arguments: '{"cidade":"Recife"}' },
      },
    ]);
  });
});

describe("SPEC-006 criterion 4: usage", () => {
  it("adds the usage chunk with empty choices right before [DONE] with include_usage", async () => {
    router.replyStream(streamOf(replay(textParts("a"))));

    const { text } = await rawStream({ stream_options: { include_usage: true } });

    const events = text.split("\n\n").filter(Boolean);
    expect(events.at(-1)).toBe("data: [DONE]");
    expect(JSON.parse((events.at(-2) ?? "").replace(/^data: /, ""))).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
  });

  it("puts no usage in any chunk without the option", async () => {
    router.replyStream(streamOf(replay(textParts("a"))));

    const { text } = await rawStream({});

    expect(text).not.toContain('"usage"');
  });

  it("is understood by the SDK, which exposes the usage on the last chunk", async () => {
    router.replyStream(streamOf(replay(textParts("a"))));

    const stream = await client.chat.completions.create({
      model: "code",
      messages: hello,
      stream: true,
      stream_options: { include_usage: true },
    });
    const all: OpenAI.Chat.ChatCompletionChunk[] = [];
    for await (const chunk of stream) all.push(chunk);

    expect(all.at(-1)?.usage?.total_tokens).toBe(15);
    expect(all.at(-1)?.choices).toEqual([]);
  });
});

describe("SPEC-006 criterion 5: error after the commit", () => {
  async function* failsAfterThree(): AsyncGenerator<Part> {
    yield { type: "start-step", request: {}, warnings: [] };
    for (const text of ["1", "2", "3"]) yield { type: "text-delta", id: "t", text };
    yield { type: "error", error: new Error("provider exploded") };
  }

  it("delivers the 3 deltas, then the error event, and never [DONE]", async () => {
    router.replyStream(streamOf(failsAfterThree()));

    const { response, text } = await rawStream({});

    expect(response.status).toBe(200);
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain("provider exploded");
    expect(text.trimEnd().split("\n\n").at(-1)).toBe(
      'data: {"error":{"message":"upstream interrompeu a geração","type":"api_error","code":"upstream_stream_error"}}',
    );
  });

  it("makes the openai SDK throw after the deltas", async () => {
    router.replyStream(streamOf(failsAfterThree()));

    const stream = await client.chat.completions.create({
      model: "code",
      messages: hello,
      stream: true,
    });
    const seen: string[] = [];
    const consume = async () => {
      for await (const chunk of stream) seen.push(chunk.choices[0]?.delta.content ?? "");
    };

    await expect(consume()).rejects.toMatchObject({ code: "upstream_stream_error" });
    expect(seen.join("")).toBe("123");
  });
});

describe("before the commit, errors are plain JSON, not SSE", () => {
  it("answers the error table status with the OpenAI error body", async () => {
    router.replyStream(
      new GatewayError("upstream_rate_limited", "The upstream models are rate limited."),
    );

    await expect(
      client.chat.completions.create({ model: "code", messages: hello, stream: true }),
    ).rejects.toMatchObject({
      status: 429,
      code: "upstream_rate_limited",
      type: "rate_limit_error",
    });
  });

  it("still rejects an invalid request with 400 before opening a stream", async () => {
    await expect(
      client.chat.completions.create({ model: "code", messages: hello, stream: true, n: 2 }),
    ).rejects.toMatchObject({ status: 400, code: "unsupported_parameter", param: "n" });
    expect(router.received).toHaveLength(0);
  });
});

describe("SPEC-006 criterion 6: the client leaves", () => {
  it("aborts the signal handed to routing when the client disconnects after the 2nd delta", async () => {
    async function* untilAborted(): AsyncGenerator<Part> {
      yield { type: "start-step", request: {}, warnings: [] };
      yield { type: "text-delta", id: "t", text: "um" };
      yield { type: "text-delta", id: "t", text: "dois" };
      await new Promise<void>((resolve) => {
        const watch = setInterval(() => {
          if (router.lastSignal?.aborted) {
            clearInterval(watch);
            resolve();
          }
        }, 5);
      });
    }
    router.replyStream(streamOf(untilAborted()));

    const stream = await client.chat.completions.create({
      model: "code",
      messages: hello,
      stream: true,
    });
    let seen = 0;
    for await (const _chunk of stream) {
      seen += 1;
      if (seen === 3) stream.controller.abort();
    }

    await new Promise<void>((resolve) => {
      const wait = setInterval(() => {
        if (router.lastSignal?.aborted) {
          clearInterval(wait);
          resolve();
        }
      }, 5);
    });
    expect(router.lastSignal?.aborted).toBe(true);
  });
});
