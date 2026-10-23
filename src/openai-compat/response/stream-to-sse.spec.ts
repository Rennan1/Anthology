import { EventEmitter } from "node:events";
import { jest } from "@jest/globals";
import type { TextStreamPart, ToolSet } from "ai";
import { createChunkMapper } from "../translate/stream-chunks.js";
import { type SseResponse, streamToSse } from "./stream-to-sse.js";

type Part = TextStreamPart<ToolSet>;

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: 1, reasoningTokens: undefined },
};
const text = (value: string): Part => ({ type: "text-delta", id: "t", text: value });
const finish: Part = {
  type: "finish",
  finishReason: "stop",
  rawFinishReason: "stop",
  totalUsage: usage,
};

class FakeResponse extends EventEmitter implements SseResponse {
  readonly written: string[] = [];
  ended = false;
  /** Number of upcoming writes that report a full buffer (`false`). */
  fullBuffers = 0;
  write(chunk: string): boolean {
    this.written.push(chunk);
    if (this.fullBuffers > 0) {
      this.fullBuffers -= 1;
      return false;
    }
    return true;
  }
  end(): void {
    this.ended = true;
  }
  get body(): string {
    return this.written.join("");
  }
}

async function* from(...parts: Part[]): AsyncGenerator<Part> {
  for (const part of parts) yield part;
}

const mapper = (includeUsage = false) =>
  createChunkMapper({ id: "chatcmpl-1", created: 7, model: "code", includeUsage });

const events = (res: FakeResponse) =>
  res.body
    .split("\n\n")
    .filter((event) => event !== "")
    .map((event) => (event.startsWith("data: ") ? event.slice(6) : event));

describe("streamToSse: the wire format", () => {
  it("writes role, deltas, finish and [DONE], each as `data: <json>` + blank line", async () => {
    const res = new FakeResponse();

    await streamToSse({ res, parts: from(text("Olá"), text("!"), finish), mapper: mapper() });

    const wire = events(res);
    expect(wire.slice(0, -1).map((json) => JSON.parse(json).choices[0].delta)).toEqual([
      { role: "assistant", content: "" },
      { content: "Olá" },
      { content: "!" },
      {},
    ]);
    expect(wire.at(-1)).toBe("[DONE]");
    expect(res.body.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(res.ended).toBe(true);
  });

  it("puts the usage chunk right before [DONE] when asked", async () => {
    const res = new FakeResponse();

    await streamToSse({ res, parts: from(text("a"), finish), mapper: mapper(true) });

    const wire = events(res);
    expect(wire.at(-1)).toBe("[DONE]");
    expect(JSON.parse(wire.at(-2) ?? "")).toMatchObject({
      choices: [],
      usage: { total_tokens: 2 },
    });
  });
});

describe("streamToSse: errors (criterion 5)", () => {
  const streamError = {
    error: {
      message: "upstream interrompeu a geração",
      type: "api_error",
      code: "upstream_stream_error",
    },
  };

  it("sends the deltas, then the error event, and never [DONE]", async () => {
    const res = new FakeResponse();

    await streamToSse({
      res,
      parts: from(text("1"), text("2"), text("3"), { type: "error", error: new Error("boom") }),
      mapper: mapper(),
    });

    const wire = events(res);
    expect(wire.slice(1, 4).map((json) => JSON.parse(json).choices[0].delta.content)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(JSON.parse(wire.at(-1) ?? "")).toEqual(streamError);
    expect(res.body).not.toContain("[DONE]");
    expect(res.ended).toBe(true);
  });

  it("treats an upstream that ends without a finish part as an interruption", async () => {
    const res = new FakeResponse();

    await streamToSse({ res, parts: from(text("a")), mapper: mapper() });

    expect(JSON.parse(events(res).at(-1) ?? "")).toEqual(streamError);
    expect(res.body).not.toContain("[DONE]");
  });

  it("does not leak the exception text when the upstream iterator throws", async () => {
    const res = new FakeResponse();
    async function* broken(): AsyncGenerator<Part> {
      yield text("a");
      throw new Error("SEGREDO-INTERNO");
    }

    await streamToSse({ res, parts: broken(), mapper: mapper() });

    expect(res.body).not.toContain("SEGREDO-INTERNO");
    expect(JSON.parse(events(res).at(-1) ?? "")).toEqual(streamError);
    expect(res.ended).toBe(true);
  });
});

describe("streamToSse: backpressure", () => {
  it("waits for drain before writing again when write reports a full buffer", async () => {
    const res = new FakeResponse();
    res.fullBuffers = 1;
    const done = streamToSse({ res, parts: from(text("a"), text("b"), finish), mapper: mapper() });

    await new Promise((resolve) => setImmediate(resolve));
    const stalledAt = res.written.length;
    res.emit("drain");
    await done;

    expect(stalledAt).toBe(1);
    expect(res.written.length).toBeGreaterThan(stalledAt);
    expect(res.body.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("stops waiting when the client goes away instead of hanging", async () => {
    const res = new FakeResponse();
    res.fullBuffers = 1;
    const done = streamToSse({ res, parts: from(text("a"), text("b"), finish), mapper: mapper() });

    await new Promise((resolve) => setImmediate(resolve));
    res.emit("close");

    await expect(done).resolves.toBeUndefined();
    expect(res.body).not.toContain("[DONE]");
  });
});

describe("streamToSse: client disconnect", () => {
  it("stops reading the upstream and writes nothing more after close", async () => {
    const res = new FakeResponse();
    let pulled = 0;
    async function* endless(): AsyncGenerator<Part> {
      while (true) {
        pulled += 1;
        yield text("x");
        if (pulled === 2) res.emit("close");
      }
    }

    await streamToSse({ res, parts: endless(), mapper: mapper() });

    expect(pulled).toBeLessThanOrEqual(3);
    expect(res.body).not.toContain("[DONE]");
  });
});

describe("streamToSse: keep-alive (criterion 7)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sends `: keep-alive` every 15 s while the model has nothing to say", async () => {
    const res = new FakeResponse();
    async function* slow(): AsyncGenerator<Part> {
      yield { type: "start-step", request: {}, warnings: [] };
      await new Promise((resolve) => setTimeout(resolve, 40_000));
      yield text("finalmente");
      yield finish;
    }

    const done = streamToSse({ res, parts: slow(), mapper: mapper() });
    await jest.advanceTimersByTimeAsync(40_000);
    await done;

    const keepAlives = res.written.filter((chunk) => chunk === ": keep-alive\n\n");
    expect(keepAlives).toHaveLength(2);
    expect(res.body.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("does not send keep-alives while content is flowing", async () => {
    const res = new FakeResponse();
    async function* steady(): AsyncGenerator<Part> {
      for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        yield text(String(i));
      }
      yield finish;
    }

    const done = streamToSse({ res, parts: steady(), mapper: mapper() });
    await jest.advanceTimersByTimeAsync(40_000);
    await done;

    expect(res.written.some((chunk) => chunk.startsWith(":"))).toBe(false);
  });

  it("stops the timer when the stream ends", async () => {
    const res = new FakeResponse();

    await streamToSse({ res, parts: from(text("a"), finish), mapper: mapper() });
    const before = res.written.length;
    await jest.advanceTimersByTimeAsync(60_000);

    expect(res.written.length).toBe(before);
    expect(jest.getTimerCount()).toBe(0);
  });
});
