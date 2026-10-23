import { mockCatalog } from "../../test/support/catalog.js";
import { testConfig } from "../../test/support/config-fixture.js";
import { scriptedModel } from "../../test/support/scripted-model.js";
import type { GatewayRequest } from "./gateway.types.js";
import { GatewayError } from "./gateway-error.js";
import { planRoute, visibleRouteIds } from "./route-plan.js";

const config = testConfig();
const catalog = mockCatalog(config, {
  sonnet: scriptedModel(),
  flash: scriptedModel(),
  mini: scriptedModel(),
});
const backoffice = { keyId: "app-backoffice" };
const chatbot = { keyId: "app-chatbot" };

const request = (overrides: Partial<GatewayRequest> = {}): GatewayRequest => ({
  model: "code",
  continuationRoute: undefined,
  messages: [{ role: "user", content: "oi" }],
  params: {},
  tools: undefined,
  toolChoice: undefined,
  parallelToolCalls: undefined,
  responseFormat: undefined,
  endUser: undefined,
  ...overrides,
});

function errorOf(run: () => unknown): GatewayError {
  try {
    run();
  } catch (err) {
    if (err instanceof GatewayError) return err;
    throw err;
  }
  throw new Error("expected GatewayError");
}

const plan = (req: GatewayRequest, caller = backoffice, cfg = config) =>
  planRoute({ request: req, caller, config: cfg, catalog });

describe("visibleRouteIds", () => {
  it("lists every route for a wildcard key, in config order", () => {
    expect(visibleRouteIds(config, backoffice)).toEqual(["code", "summarize", "general"]);
  });

  it("lists only the routes a key may use", () => {
    expect(visibleRouteIds(config, chatbot)).toEqual(["summarize", "general"]);
  });

  it("lists nothing for an unknown key", () => {
    expect(visibleRouteIds(config, { keyId: "ghost" })).toEqual([]);
  });
});

describe("planRoute: explicit route", () => {
  it("builds the chain [target, ...fallbacks] with the catalog models", () => {
    const planned = plan(request({ model: "code" }));

    expect(planned.routeId).toBe("code");
    expect(planned.routedBy).toBe("client");
    expect(planned.candidates.map((c) => c.modelKey)).toEqual(["sonnet", "mini"]);
    expect(planned.skipped).toEqual([]);
  });

  it("answers 404 model_not_found for an unknown route", () => {
    const err = errorOf(() => plan(request({ model: "ghost" })));

    expect(err).toMatchObject({ code: "model_not_found", param: "model" });
  });

  it("answers 404 model_not_found for a route the key may not use (criterion 10)", () => {
    const err = errorOf(() => plan(request({ model: "code" }), chatbot));

    expect(err).toMatchObject({ code: "model_not_found", param: "model" });
  });

  it("skips a candidate without the required capability and keeps the rest (criterion 4)", () => {
    const cfg = testConfig((c) => {
      c.models.sonnet.capabilities = ["vision"];
    });

    const planned = plan(
      request({ model: "code", tools: [{ type: "function" }] }),
      backoffice,
      cfg,
    );

    expect(planned.candidates.map((c) => c.modelKey)).toEqual(["mini"]);
    expect(planned.skipped).toEqual([
      { model: "sonnet", reason: "missing_capability", missing: ["tools"] },
    ]);
  });

  it("answers 400 unsupported_capability when no candidate has the capability (criterion 5)", () => {
    const image = { role: "user", content: [{ type: "image", image: "x" }] };

    const cfg = testConfig((c) => {
      c.models.flash.capabilities = ["tools", "json_schema"];
    });

    const err = errorOf(() =>
      plan(request({ model: "general", messages: [image] }), backoffice, cfg),
    );

    expect(err.code).toBe("unsupported_capability");
    expect(err.message).toContain("vision");
  });
});

describe("planRoute: model auto", () => {
  const auto = (overrides: Partial<GatewayRequest> = {}) =>
    request({ model: "auto", ...overrides });

  it("falls back to the orchestrator defaultRoute until SPEC-009 chooses", () => {
    const planned = plan(auto());

    expect(planned).toMatchObject({ routeId: "general", routedBy: "default" });
  });

  it("uses the only eligible route as single_option", () => {
    const cfg = testConfig((c) => {
      c.auth.keys[1].routes = ["summarize"];
    });

    const planned = plan(auto(), chatbot, cfg);

    expect(planned).toMatchObject({ routeId: "summarize", routedBy: "single_option" });
  });

  it("reuses the continuation route when the last message is a tool result", () => {
    const messages = [
      { role: "user", content: "oi" },
      { role: "tool", content: "ok" },
    ];

    const planned = plan(auto({ messages, continuationRoute: "code" }));

    expect(planned).toMatchObject({ routeId: "code", routedBy: "continuation" });
  });

  it("ignores a continuation route the key may not use (negative control)", () => {
    const messages = [{ role: "tool", content: "ok" }];

    const planned = plan(auto({ messages, continuationRoute: "code" }), chatbot);

    expect(planned.routedBy).not.toBe("continuation");
    expect(planned.routeId).not.toBe("code");
  });

  it("ignores the continuation header when the last message is not a tool result", () => {
    const planned = plan(auto({ continuationRoute: "code" }));

    expect(planned.routedBy).toBe("default");
  });

  it("answers 400 unsupported_capability when no allowed route can serve the request", () => {
    const cfg = testConfig((c) => {
      for (const model of Object.values<{ capabilities: string[] }>(c.models)) {
        model.capabilities = ["json_schema"];
      }
    });

    const err = errorOf(() => plan(auto({ tools: [{ type: "function" }] }), backoffice, cfg));

    expect(err.code).toBe("unsupported_capability");
  });

  it("excludes routes whose candidates all lack a required capability from the eligible set", () => {
    const cfg = testConfig((c) => {
      c.models.mini.capabilities = ["json_schema"];
      c.models.flash.capabilities = ["json_schema"];
    });
    const image = { role: "user", content: [{ type: "image", image: "x" }] };

    const planned = plan(auto({ messages: [image] }), backoffice, cfg);

    expect(planned).toMatchObject({ routeId: "code", routedBy: "single_option" });
  });
});
