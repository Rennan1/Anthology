import type { MockLanguageModelV4 } from "ai/test";
import { mockCatalog } from "../../test/support/catalog.js";
import { type ConfigJson, testConfig } from "../../test/support/config-fixture.js";
import {
  HANG,
  httpError,
  networkError,
  scriptedModel,
  textReply,
  toolCallReply,
} from "../../test/support/scripted-model.js";
import type { GatewayRequest, GatewayResult } from "./gateway.types.js";
import { GatewayError } from "./gateway-error.js";
import { RoutingService } from "./routing.service.js";
import type { RoutingCompletedEvent, RoutingRecorder } from "./routing-recorder.js";

const caller = { keyId: "app-backoffice" };

const request = (overrides: Partial<GatewayRequest> = {}): GatewayRequest => ({
  model: "code",
  continuationRoute: undefined,
  messages: [{ role: "user", content: [{ type: "text", text: "oi" }] }],
  params: {},
  tools: undefined,
  toolChoice: undefined,
  parallelToolCalls: undefined,
  responseFormat: undefined,
  endUser: undefined,
  ...overrides,
});

class CapturingRecorder implements RoutingRecorder {
  readonly events: RoutingCompletedEvent[] = [];
  completed(event: RoutingCompletedEvent): void {
    this.events.push(event);
  }
}

interface Setup {
  service: RoutingService;
  recorder: CapturingRecorder;
  models: Record<string, MockLanguageModelV4>;
}

function setup(
  models: Partial<Record<"sonnet" | "flash" | "mini", MockLanguageModelV4>>,
  change?: Parameters<typeof testConfig>[0],
): Setup {
  const config = testConfig(change);
  const all = {
    sonnet: scriptedModel(),
    flash: scriptedModel(),
    mini: scriptedModel(),
    ...models,
  };
  const recorder = new CapturingRecorder();
  const service = new RoutingService(config, mockCatalog(config, all), recorder);
  return { service, recorder, models: all };
}

const run = (s: Setup, req = request(), signal = new AbortController().signal) =>
  s.service.complete(req, caller, signal);

async function errorOf(promise: Promise<unknown>): Promise<GatewayError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof GatewayError) return err;
    throw err;
  }
  throw new Error("expected GatewayError");
}

const calls = (model: MockLanguageModelV4 | undefined) => model?.doGenerateCalls.length;

describe("RoutingService.complete: the success path (criterion 1)", () => {
  it("answers from the target with one attempt and maps the AI SDK result", async () => {
    const s = setup({ sonnet: scriptedModel(textReply("olá")) });

    const result = await run(s);

    expect(result).toEqual<GatewayResult>({
      text: "olá",
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
      route: "code",
      routedBy: "client",
      modelKey: "sonnet",
      attempts: 1,
    });
    expect(calls(s.models.sonnet)).toBe(1);
    expect(calls(s.models.mini)).toBe(0);
  });

  it("maps tool calls, with the input as an object", async () => {
    const s = setup({
      sonnet: scriptedModel(toolCallReply("call_1", "get_weather", { city: "SP" })),
    });

    const result = await run(s);

    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "get_weather", input: { city: "SP" } },
    ]);
    expect(result.finishReason).toBe("tool-calls");
  });

  it("reports usage 0 when the provider sends none, never leaves it out", async () => {
    const noUsage = {
      ...textReply("x"),
      usage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      },
    };
    const s = setup({ sonnet: scriptedModel(noUsage) });

    const result = await run(s);

    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it("maps the AI SDK interrupted finish reason to other", async () => {
    const s = setup({ sonnet: scriptedModel(textReply("meio", "interrupted")) });

    expect((await run(s)).finishReason).toBe("other");
  });

  it("logs one routing.completed event with the attempt", async () => {
    const s = setup({ sonnet: scriptedModel(textReply("olá")) });

    await run(s);

    expect(s.recorder.events).toEqual([
      {
        route: "code",
        routedBy: "client",
        attempts: [{ model: "sonnet", outcome: "ok", latencyMs: expect.any(Number) }],
        skipped: [],
      },
    ]);
  });
});

describe("RoutingService.complete: fallback", () => {
  it("goes to the fallback on a retryable error (criterion 2)", async () => {
    const s = setup({
      sonnet: scriptedModel(httpError(429)),
      mini: scriptedModel(textReply("do mini")),
    });

    const result = await run(s);

    expect(result).toMatchObject({ text: "do mini", modelKey: "mini", attempts: 2, route: "code" });
    expect(s.recorder.events[0]?.attempts).toEqual([
      {
        model: "sonnet",
        outcome: "error",
        status: 429,
        kind: "rate_limited",
        latencyMs: expect.any(Number),
      },
      { model: "mini", outcome: "ok", latencyMs: expect.any(Number) },
    ]);
  });

  it("goes to the fallback on a transport failure", async () => {
    const s = setup({
      sonnet: scriptedModel(networkError()),
      mini: scriptedModel(textReply("ok")),
    });

    expect((await run(s)).modelKey).toBe("mini");
  });

  it("does not call the fallback on a non-retryable error (criterion 3)", async () => {
    const s = setup({
      sonnet: scriptedModel(httpError(400)),
      mini: scriptedModel(textReply("não")),
    });

    const err = await errorOf(run(s));

    expect(err).toMatchObject({ code: "upstream_rejected", upstreamStatus: 400 });
    expect(calls(s.models.mini)).toBe(0);
  });

  it("answers 502 upstream_unavailable on 401/403, without detail, and does not fall back", async () => {
    const s = setup({
      sonnet: scriptedModel(httpError(401)),
      mini: scriptedModel(textReply("não")),
    });

    const err = await errorOf(run(s));

    expect(err.code).toBe("upstream_unavailable");
    expect(err.message).not.toMatch(/401|key/i);
    expect(calls(s.models.mini)).toBe(0);
  });

  it("answers 429 upstream_rate_limited when every candidate was rate limited", async () => {
    const s = setup({ sonnet: scriptedModel(httpError(429)), mini: scriptedModel(httpError(429)) });

    expect((await errorOf(run(s))).code).toBe("upstream_rate_limited");
  });

  it("answers upstream_unavailable when the chain fails with a mix of retryable errors", async () => {
    const s = setup({ sonnet: scriptedModel(httpError(503)), mini: scriptedModel(httpError(429)) });

    expect((await errorOf(run(s))).code).toBe("upstream_unavailable");
  });

  it("falls back after a candidate timeout, and answers upstream_timeout when all time out", async () => {
    const change = (c: ConfigJson) => {
      c.models.sonnet.timeoutMs = 25;
      c.models.mini.timeoutMs = 25;
    };
    const recovered = setup(
      { sonnet: scriptedModel(HANG), mini: scriptedModel(textReply("ok")) },
      change,
    );
    const exhausted = setup({ sonnet: scriptedModel(HANG), mini: scriptedModel(HANG) }, change);

    expect((await run(recovered)).modelKey).toBe("mini");
    expect((await errorOf(run(exhausted))).code).toBe("upstream_timeout");
  });

  it("stops everything when the client aborts: no fallback, no further attempts", async () => {
    const s = setup({ sonnet: scriptedModel(HANG), mini: scriptedModel(textReply("não")) });
    const abort = new AbortController();

    const pending = errorOf(run(s, request(), abort.signal));
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    await pending;

    expect(calls(s.models.mini)).toBe(0);
    expect(s.recorder.events[0]?.attempts.at(-1)?.outcome).toBe("client_aborted");
  });

  it("serves a model:auto request from the fallback of the route it landed on (criterion 11)", async () => {
    const s = setup({
      mini: scriptedModel(httpError(429)),
      flash: scriptedModel(textReply("do flash")),
    });

    const result = await run(s, request({ model: "auto" }));

    expect(result).toMatchObject({ route: "general", routedBy: "default", modelKey: "flash" });
  });
});

describe("RoutingService.complete: capabilities (criteria 4 and 5)", () => {
  it("skips a target without tools, never calls it, and the fallback answers", async () => {
    const s = setup({ mini: scriptedModel(textReply("com tools")) }, (c) => {
      c.models.sonnet.capabilities = ["vision"];
    });

    const result = await run(s, request({ tools: [{ type: "function" }] }));

    expect(result).toMatchObject({ modelKey: "mini", attempts: 1 });
    expect(calls(s.models.sonnet)).toBe(0);
    expect(s.recorder.events[0]?.skipped).toEqual([
      { model: "sonnet", reason: "missing_capability", missing: ["tools"] },
    ]);
  });

  it("answers 400 unsupported_capability with zero calls to any model", async () => {
    const s = setup({}, (c) => {
      c.models.flash.capabilities = ["tools", "json_schema"];
    });
    const image = { role: "user", content: [{ type: "image", image: "x" }] };

    const err = await errorOf(run(s, request({ model: "general", messages: [image] })));

    expect(err.code).toBe("unsupported_capability");
    for (const model of Object.values(s.models)) expect(calls(model)).toBe(0);
  });
});

describe("RoutingService.complete: what reaches the model (criteria 8 and 9)", () => {
  it("applies the route enforce over the request", async () => {
    const s = setup({ mini: scriptedModel(textReply("ok")) });

    await run(s, request({ model: "general", params: { maxOutputTokens: 10000 } }));

    expect(s.models.mini?.doGenerateCalls[0]?.maxOutputTokens).toBe(4000);
  });

  it("lets the request beat the model default", async () => {
    const s = setup({ sonnet: scriptedModel(textReply("ok")) }, (c) => {
      c.models.sonnet.defaults = { temperature: 0.2 };
    });

    await run(s, request({ params: { temperature: 0.9 } }));

    expect(s.models.sonnet?.doGenerateCalls[0]?.temperature).toBe(0.9);
  });

  it("recomputes the merge for the fallback", async () => {
    const s = setup(
      { sonnet: scriptedModel(httpError(503)), mini: scriptedModel(textReply("ok")) },
      (c) => {
        c.models.sonnet.maxOutputTokens = 100;
        c.models.mini.maxOutputTokens = 500;
      },
    );

    await run(s, request({ params: { maxOutputTokens: 1000 } }));

    expect(s.models.sonnet?.doGenerateCalls[0]?.maxOutputTokens).toBe(100);
    expect(s.models.mini?.doGenerateCalls[0]?.maxOutputTokens).toBe(500);
  });

  it("sends providerOptions under the provider namespace, and nothing when there are none", async () => {
    const s = setup(
      { sonnet: scriptedModel(textReply("ok")), mini: scriptedModel(textReply("ok")) },
      (c) => {
        c.models.sonnet.providerOptions = { provider: { order: ["anthropic"] } };
      },
    );

    await run(s);
    await run(s, request({ model: "general" }));

    expect(s.models.sonnet?.doGenerateCalls[0]?.providerOptions).toEqual({
      openrouter: { provider: { order: ["anthropic"] } },
    });
    expect(s.models.mini?.doGenerateCalls[0]?.providerOptions).toBeUndefined();
  });

  it("hands the AI SDK the abort signal of the request", async () => {
    const s = setup({ sonnet: scriptedModel(textReply("ok")) });
    const abort = new AbortController();

    await run(s, request(), abort.signal);
    abort.abort();

    expect(s.models.sonnet?.doGenerateCalls[0]?.abortSignal?.aborted).toBe(true);
  });
});
