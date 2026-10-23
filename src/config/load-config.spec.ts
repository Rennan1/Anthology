import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "./config-error.js";
import { loadConfig, type ParseConfigOptions, parseConfig } from "./load-config.js";

// biome-ignore lint/suspicious/noExplicitAny: fixture mutation helper, tests poke arbitrary paths
type Json = Record<string, any>;

const ENV = {
  OPENROUTER_API_KEY: "provider-key-sentinel",
  ANTHOLOGY_KEY_BACKOFFICE: "gateway-key-backoffice-sentinel",
  ANTHOLOGY_KEY_CHATBOT: "gateway-key-chatbot-sentinel",
};
const OPTIONS: ParseConfigOptions = { env: ENV, providerTypes: ["openrouter"] };

function example(): Json {
  return JSON.parse(readFileSync("anthology.config.example.json", "utf8"));
}

function mutated(change: (config: Json) => void): Json {
  const config = example();
  change(config);
  return config;
}

function issuesOf(raw: unknown, options = OPTIONS): { path: string; message: string }[] {
  try {
    parseConfig(raw, options);
  } catch (err) {
    if (err instanceof ConfigError) return [...err.issues];
    throw err;
  }
  throw new Error("expected ConfigError, but parsing succeeded");
}

describe("parseConfig", () => {
  it("accepts the committed example and resolves *Env references", () => {
    const config = parseConfig(example(), OPTIONS);

    expect(config.routes.code?.target).toBe("sonnet");
    expect(config.providers.openrouter?.apiKey).toBe(ENV.OPENROUTER_API_KEY);
    expect(config.auth.keys.map((key) => key.key)).toEqual([
      ENV.ANTHOLOGY_KEY_BACKOFFICE,
      ENV.ANTHOLOGY_KEY_CHATBOT,
    ]);
  });

  it("applies the documented defaults", () => {
    const config = parseConfig(
      mutated((c) => {
        delete c.server;
        delete c.logging;
        delete c.models.mini.timeoutMs;
        delete c.models.mini.maxRetries;
        delete c.routes.code.fallbacks;
        delete c.orchestrator.timeoutMs;
        delete c.orchestrator.context;
      }),
      OPTIONS,
    );

    expect(config.server).toEqual({ port: 8080, bodyLimit: "10mb", shutdownGraceMs: 30000 });
    expect(config.logging).toEqual({ level: "info", includeContent: false });
    expect(config.models.mini).toMatchObject({ timeoutMs: 120000, maxRetries: 1 });
    expect(config.routes.code?.fallbacks).toEqual([]);
    expect(config.orchestrator.timeoutMs).toBe(5000);
    expect(config.orchestrator.context).toEqual({
      maxMessages: 6,
      maxCharsPerMessage: 2000,
      maxChars: 8000,
    });
  });

  it("returns a deeply frozen config", () => {
    const config = parseConfig(example(), OPTIONS) as unknown as Json;

    expect(() => {
      config.routes.code.target = "mini";
    }).toThrow(TypeError);
    expect(() => {
      config.routes.code.fallbacks.push("flash");
    }).toThrow(TypeError);
    expect(() => {
      config.auth.keys[0].routes[0] = "x";
    }).toThrow(TypeError);
  });

  describe("integrity validations (SPEC-002)", () => {
    const cases: [string, (c: Json) => void, string, string][] = [
      ["1. id with a colon", (c) => (c.models["a:b"] = c.models.mini), "models.a:b", "id"],
      [
        "1. id with uppercase in a route",
        (c) => (c.routes.Code = c.routes.code),
        "routes.Code",
        "id",
      ],
      [
        "1. gateway key id too long",
        (c) => (c.auth.keys[0].id = "a".repeat(65)),
        "auth.keys[0].id",
        "id",
      ],
      [
        "2. model with unknown provider",
        (c) => (c.models.sonnet.provider = "ghost"),
        "models.sonnet.provider",
        "ghost",
      ],
      [
        "2. provider type without a factory",
        (c) => (c.providers.openrouter.type = "inexistente"),
        "providers.openrouter.type",
        "inexistente",
      ],
      [
        "3. route target missing from models",
        (c) => (c.routes.code.target = "ghost"),
        "routes.code.target",
        "ghost",
      ],
      [
        "3. fallback missing from models",
        (c) => (c.routes.code.fallbacks = ["mini", "ghost"]),
        "routes.code.fallbacks[1]",
        "ghost",
      ],
      [
        "3. repeated fallback in a chain",
        (c) => (c.routes.code.fallbacks = ["mini", "mini"]),
        "routes.code.fallbacks[1]",
        "repeated",
      ],
      [
        "3. target repeated in fallbacks",
        (c) => (c.routes.code.fallbacks = ["sonnet"]),
        "routes.code.fallbacks[0]",
        "target",
      ],
      [
        "4. gateway key naming an unknown route",
        (c) => (c.auth.keys[1].routes = ["general", "ghost"]),
        "auth.keys[1].routes[1]",
        "ghost",
      ],
      [
        "4. duplicate gateway key id",
        (c) => (c.auth.keys[1].id = "app-backoffice"),
        "auth.keys[1].id",
        "duplicate",
      ],
      [
        "4. duplicate gateway keyEnv",
        (c) => (c.auth.keys[1].keyEnv = "ANTHOLOGY_KEY_BACKOFFICE"),
        "auth.keys[1].keyEnv",
        "duplicate",
      ],
      ["5. no gateway keys", (c) => (c.auth.keys = []), "auth.keys", "at least one"],
      [
        "6. sk- prefixed header",
        (c) => (c.providers.openrouter.headers.Authorization = "sk-or-v1-abc"),
        "providers.openrouter.headers.Authorization",
        "*Env",
      ],
      [
        "6. Bearer header",
        (c) => (c.providers.openrouter.headers.Authorization = "Bearer abc"),
        "providers.openrouter.headers.Authorization",
        "*Env",
      ],
      [
        "6. 32+ char token nested in providerOptions",
        (c) =>
          (c.models.sonnet.providerOptions = { a: { b: ["0123456789abcdef0123456789abcdef"] } }),
        "models.sonnet.providerOptions.a.b[0]",
        "*Env",
      ],
      ["7. version 2", (c) => (c.version = 2), "version", "1"],
      ["8. route named auto", (c) => (c.routes.auto = c.routes.code), "routes.auto", "reserved"],
      [
        "9. orchestrator model unknown",
        (c) => (c.orchestrator.model = "ghost"),
        "orchestrator.model",
        "ghost",
      ],
      [
        "9. orchestrator model without json_schema",
        (c) => (c.models.flash.capabilities = ["tools"]),
        "orchestrator.model",
        "json_schema",
      ],
      [
        "9. orchestrator fallback without json_schema",
        (c) => (c.models.mini.capabilities = ["tools"]),
        "orchestrator.fallbacks[0]",
        "json_schema",
      ],
      [
        "9. orchestrator defaultRoute unknown",
        (c) => (c.orchestrator.defaultRoute = "ghost"),
        "orchestrator.defaultRoute",
        "ghost",
      ],
    ];

    it.each(cases)("%s fails naming the JSON path", (_name, change, path, fragment) => {
      const issues = issuesOf(mutated(change));

      const hit = issues.find((issue) => issue.path === path);
      expect(hit?.message).toContain(fragment);
    });

    it("accepts a model id that merely contains a dot, dash or underscore", () => {
      expect(() =>
        parseConfig(
          mutated((c) => {
            c.models["gpt-5.mini_v2"] = c.models.mini;
          }),
          OPTIONS,
        ),
      ).not.toThrow();
    });
  });

  it("reports every error, not only the first", () => {
    const issues = issuesOf(
      mutated((c) => {
        c.routes.code.target = "ghost";
        c.orchestrator.defaultRoute = "phantom";
      }),
    );

    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["routes.code.target", "orchestrator.defaultRoute"]),
    );
    const message = (() => {
      try {
        parseConfig(
          mutated((c) => {
            c.routes.code.target = "ghost";
            c.orchestrator.defaultRoute = "phantom";
          }),
          OPTIONS,
        );
      } catch (err) {
        return (err as Error).message;
      }
      return "";
    })();
    expect(message).toContain("routes.code.target");
    expect(message).toContain("orchestrator.defaultRoute");
  });

  describe("environment references", () => {
    it.each([
      ["missing", undefined],
      ["empty", ""],
    ])("aborts on a %s apiKeyEnv, naming the variable and never a value", (_name, value) => {
      const env: NodeJS.ProcessEnv = { ...ENV, OPENROUTER_API_KEY: value };
      if (value === undefined) delete env.OPENROUTER_API_KEY;

      const issues = issuesOf(example(), { ...OPTIONS, env });

      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toBe("providers.openrouter.apiKeyEnv");
      expect(issues[0]?.message).toContain("OPENROUTER_API_KEY");
      expect(JSON.stringify(issues)).not.toContain(ENV.ANTHOLOGY_KEY_CHATBOT);
    });

    it("aborts on a missing gateway keyEnv", () => {
      const { ANTHOLOGY_KEY_CHATBOT: _omitted, ...env } = ENV;

      const issues = issuesOf(example(), { ...OPTIONS, env });

      expect(issues.map((issue) => issue.path)).toEqual(["auth.keys[1].keyEnv"]);
    });
  });

  describe("schema", () => {
    it("rejects an unknown field (typos must not pass silently)", () => {
      const issues = issuesOf(mutated((c) => (c.routes.code.targt = "mini")));

      expect(issues.some((issue) => issue.path === "routes.code")).toBe(true);
    });

    it("accepts the $schema editor hint", () => {
      expect(() => parseConfig(example(), OPTIONS)).not.toThrow();
    });

    it.each([
      [
        "a route description above 300 chars",
        (c: Json) => (c.routes.code.description = "x".repeat(301)),
        "routes.code.description",
      ],
      [
        "an unknown capability",
        (c: Json) => (c.models.sonnet.capabilities = ["audio"]),
        "models.sonnet.capabilities[0]",
      ],
      [
        "maxRetries above 3",
        (c: Json) => (c.models.sonnet.maxRetries = 4),
        "models.sonnet.maxRetries",
      ],
      [
        "a non-https baseURL",
        (c: Json) => (c.providers.openrouter.baseURL = "http://x.test"),
        "providers.openrouter.baseURL",
      ],
      [
        "orchestrator instructions above 2000 chars",
        (c: Json) => (c.orchestrator.instructions = "x".repeat(2001)),
        "orchestrator.instructions",
      ],
      [
        "a temperature above 2 in enforce",
        (c: Json) => (c.routes.general.enforce.temperature = 3),
        "routes.general.enforce.temperature",
      ],
    ])("rejects %s", (_name, change, path) => {
      const issues = issuesOf(mutated(change));

      expect(issues.map((issue) => issue.path)).toContain(path);
    });
  });
});

describe("loadConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anthology-config-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function write(name: string, content: string): string {
    const file = join(dir, name);
    writeFileSync(file, content);
    return file;
  }

  it("reads the file given by path", () => {
    const path = write("a.json", JSON.stringify(example()));

    expect(loadConfig({ ...OPTIONS, path }).routes.code?.target).toBe("sonnet");
  });

  it("falls back to ANTHOLOGY_CONFIG_PATH when no path is given", () => {
    const path = write("b.json", JSON.stringify(example()));

    const config = loadConfig({ ...OPTIONS, env: { ...ENV, ANTHOLOGY_CONFIG_PATH: path } });

    expect(config.routes.general?.target).toBe("mini");
  });

  it("fails with a ConfigError naming the path when the file is missing", () => {
    expect(() => loadConfig({ ...OPTIONS, path: join(dir, "nope.json") })).toThrow(ConfigError);
  });

  it("fails with a ConfigError on invalid JSON", () => {
    const path = write("c.json", "{ not json");

    expect(() => loadConfig({ ...OPTIONS, path })).toThrow(/not valid JSON/);
  });
});
