import type { TextStreamPart, ToolSet } from "ai";
import type { MockLanguageModelV4 } from "ai/test";
import { mockCatalog } from "../../test/support/catalog.js";
import { type ConfigJson, testConfig } from "../../test/support/config-fixture.js";
import { baseRequest, imageMessage } from "../../test/support/requests.js";
import { HANG, httpError, scriptedModel } from "../../test/support/scripted-model.js";
import { scriptedStreamModel, textStream } from "../../test/support/scripted-stream-model.js";
import type { GatewayRequest, GatewayStream } from "./gateway.types.js";
import { GatewayError } from "./gateway-error.js";
import { RoutingService } from "./routing.service.js";
import type { RoutingCompletedEvent, RoutingRecorder } from "./routing-recorder.js";

const caller = { keyId: "app-backoffice" };

class CapturingRecorder implements RoutingRecorder {
  readonly events: RoutingCompletedEvent[] = [];
  completed(event: RoutingCompletedEvent): void {
    this.events.push(event);
  }
}

interface Setup {
  service: RoutingService;
  recorder: CapturingRecorder;
  models: Record<"sonnet" | "flash" | "mini", MockLanguageModelV4>;
}

function setup(models: Partial<Setup["models"]>, change?: (c: ConfigJson) => void): Setup {
  const config = testConfig(change);
  const all = { sonnet: scriptedModel(), flash: scriptedModel(), mini: scriptedModel(), ...models };
  const recorder = new CapturingRecorder();
  return {
    service: new RoutingService(config, mockCatalog(config, all), recorder),
    recorder,
    models: all,
  };
}

const open = (
  s: Setup,
  request: GatewayRequest = baseRequest,
  signal = new AbortController().signal,
) => s.service.stream(request, caller, signal);

async function collect(stream: GatewayStream): Promise<TextStreamPart<ToolSet>[]> {
  const parts: TextStreamPart<ToolSet>[] = [];
  for await (const part of stream.parts) parts.push(part);
  return parts;
}

const textOf = (parts: TextStreamPart<ToolSet>[]) =>
  parts.flatMap((part) => (part.type === "text-delta" ? [part.text] : [])).join("");

async function errorOf(promise: Promise<unknown>): Promise<GatewayError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof GatewayError) return err;
    throw err;
  }
  throw new Error("expected GatewayError");
}

const calls = (model: MockLanguageModelV4) => model.doStreamCalls.length;
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("RoutingService.stream: the commit point", () => {
  it("resolves with the route, the serving model and the attempts, and streams the answer", async () => {
    const s = setup({ sonnet: scriptedStreamModel(textStream("Olá", " mundo")) });

    const stream = await open(s);
    const parts = await collect(stream);

    expect(stream).toMatchObject({
      route: "code",
      routedBy: "client",
      modelKey: "sonnet",
      attempts: 1,
    });
    expect(textOf(parts)).toBe("Olá mundo");
    expect(parts.at(-1)?.type).toBe("finish");
  });

  it("falls back when the target fails before the first part, and the client sees only the fallback (criteria 6, 8)", async () => {
    const s = setup({
      sonnet: scriptedStreamModel(httpError(503)),
      mini: scriptedStreamModel(textStream("do fallback")),
    });

    const stream = await open(s);
    const parts = await collect(stream);

    expect(stream).toMatchObject({ modelKey: "mini", attempts: 2 });
    expect(textOf(parts)).toBe("do fallback");
    expect(parts.some((part) => part.type === "error")).toBe(false);
  });

  it("does not treat the SDK's own `start` part as the commit: a late 503 still reaches the fallback", async () => {
    const slow = scriptedStreamModel(httpError(503));
    const original = slow.doStream;
    slow.doStream = async (options) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return original.call(slow, options);
    };
    const s = setup({ sonnet: slow, mini: scriptedStreamModel(textStream("ok")) });

    const stream = await open(s);

    expect(stream.modelKey).toBe("mini");
  });

  it("delivers a failure after the first part as an error part and never calls the fallback (criterion 7)", async () => {
    const s = setup({
      sonnet: scriptedStreamModel({
        parts: textStream("um", "dois").slice(0, 4),
        thenFail: httpError(503),
      }),
      mini: scriptedStreamModel(textStream("não")),
    });

    const stream = await open(s);
    const parts = await collect(stream);

    expect(stream.modelKey).toBe("sonnet");
    expect(textOf(parts)).toBe("umdois");
    expect(parts.at(-1)?.type === "error" || parts.some((part) => part.type === "error")).toBe(
      true,
    );
    expect(calls(s.models.mini)).toBe(0);
  });

  it("does not fall back on a non-retryable error before the first part", async () => {
    const s = setup({
      sonnet: scriptedStreamModel(httpError(400)),
      mini: scriptedStreamModel(textStream("não")),
    });

    const err = await errorOf(open(s));

    expect(err).toMatchObject({ code: "upstream_rejected", upstreamStatus: 400 });
    expect(calls(s.models.mini)).toBe(0);
  });

  it("answers the chain error when every candidate fails before the first part", async () => {
    const s = setup({
      sonnet: scriptedStreamModel(httpError(429)),
      mini: scriptedStreamModel(httpError(429)),
    });

    expect((await errorOf(open(s))).code).toBe("upstream_rate_limited");
  });

  it("fails like the non-stream path for capability and route errors, without calling a model", async () => {
    const s = setup({}, (c) => {
      c.models.flash.capabilities = ["tools", "json_schema"];
    });

    const noVision = await errorOf(
      open(s, { ...baseRequest, model: "general", messages: [imageMessage] }),
    );
    const noRoute = await errorOf(open(s, { ...baseRequest, model: "ghost" }));

    expect(noVision.code).toBe("unsupported_capability");
    expect(noRoute.code).toBe("model_not_found");
    for (const model of Object.values(s.models)) expect(calls(model)).toBe(0);
  });
});

describe("RoutingService.stream: time", () => {
  const fast = (c: ConfigJson) => {
    c.models.sonnet.timeoutMs = 40;
    c.models.mini.timeoutMs = 40;
  };

  it("times a candidate out before the first part and goes to the fallback", async () => {
    const s = setup(
      { sonnet: scriptedStreamModel(HANG), mini: scriptedStreamModel(textStream("ok")) },
      fast,
    );

    expect((await open(s)).modelKey).toBe("mini");
  });

  it("answers upstream_timeout when every candidate times out before the first part", async () => {
    const s = setup({ sonnet: scriptedStreamModel(HANG), mini: scriptedStreamModel(HANG) }, fast);

    expect((await errorOf(open(s))).code).toBe("upstream_timeout");
  });

  it("stops the candidate timeout at the commit: a long answer is not cut off", async () => {
    const parts = textStream("a", "b");
    const s = setup(
      { sonnet: scriptedStreamModel({ parts, pacing: { pauseAfter: 3, pauseMs: 120 } }) },
      fast,
    );

    const stream = await open(s);

    expect(textOf(await collect(stream))).toBe("ab");
  });
});

describe("RoutingService.stream: the client leaves (criterion 6 of SPEC-006)", () => {
  it("aborts the upstream call after the commit, records client_aborted, and calls no fallback", async () => {
    const s = setup({
      sonnet: scriptedStreamModel({ parts: textStream("um", "dois").slice(0, 3), thenHang: true }),
      mini: scriptedStreamModel(textStream("não")),
    });
    const abort = new AbortController();

    const stream = await open(s, baseRequest, abort.signal);
    const seen: string[] = [];
    for await (const part of stream.parts) {
      if (part.type === "text-delta") seen.push(part.text);
      if (seen.length === 1) abort.abort();
    }

    expect(s.models.sonnet.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
    expect(calls(s.models.mini)).toBe(0);
    expect(s.recorder.events[0]?.attempts.at(-1)?.outcome).toBe("client_aborted");
  });

  it("rejects without a fallback when the client aborts before the first part", async () => {
    const s = setup({
      sonnet: scriptedStreamModel(HANG),
      mini: scriptedStreamModel(textStream("não")),
    });
    const abort = new AbortController();

    const pending = errorOf(open(s, baseRequest, abort.signal));
    await tick();
    abort.abort();
    await pending;

    expect(calls(s.models.mini)).toBe(0);
    expect(s.recorder.events[0]?.attempts.at(-1)?.outcome).toBe("client_aborted");
  });
});

describe("RoutingService.stream: the routing.completed event", () => {
  it("is emitted once the stream ends, with the committed attempt", async () => {
    const s = setup({
      sonnet: scriptedStreamModel(httpError(503)),
      mini: scriptedStreamModel(textStream("ok")),
    });

    const stream = await open(s);
    expect(s.recorder.events).toHaveLength(0);
    await collect(stream);

    expect(s.recorder.events).toEqual([
      {
        route: "code",
        routedBy: "client",
        attempts: [
          {
            model: "sonnet",
            outcome: "error",
            status: 503,
            kind: "unavailable",
            latencyMs: expect.any(Number),
          },
          { model: "mini", outcome: "ok", latencyMs: expect.any(Number) },
        ],
        skipped: [],
      },
    ]);
  });

  it("records stream_error when the provider fails after the commit", async () => {
    const s = setup({
      sonnet: scriptedStreamModel({ parts: textStream("a").slice(0, 3), thenFail: httpError(500) }),
    });

    await collect(await open(s));

    expect(s.recorder.events[0]?.attempts.at(-1)?.outcome).toBe("stream_error");
  });

  it("is also emitted when every candidate fails before the commit", async () => {
    const s = setup({ sonnet: scriptedStreamModel(httpError(400)) });

    await errorOf(open(s));

    expect(s.recorder.events).toHaveLength(1);
    expect(s.recorder.events[0]?.attempts).toHaveLength(1);
  });
});
