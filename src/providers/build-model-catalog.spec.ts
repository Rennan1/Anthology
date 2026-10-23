import { customProvider } from "ai";
import { z } from "zod";
import { testConfig } from "../../test/support/config-fixture.js";
import { mockProviderFactory } from "../../test/support/mock-provider-factory.js";
import { scriptedModel } from "../../test/support/scripted-model.js";
import { ConfigError } from "../config/config-error.js";
import { buildModelCatalog } from "./build-model-catalog.js";
import type { ProviderFactory } from "./provider-factory.js";

const MODEL_IDS = ["anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash", "openai/gpt-5-mini"];
const mocks = Object.fromEntries(MODEL_IDS.map((id) => [id, scriptedModel()]));
const mock = mockProviderFactory(mocks);

/** The example config, with its single provider switched to the mock factory. */
const mockedConfig = (change?: Parameters<typeof testConfig>[0]) =>
  testConfig(
    (c) => {
      c.providers.openrouter.type = "mock";
      delete c.providers.openrouter.baseURL;
      change?.(c);
    },
    ["mock"],
  );

function bootErrorOf(run: () => unknown): ConfigError {
  try {
    run();
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error("expected ConfigError");
}

describe("buildModelCatalog", () => {
  it("resolves every model of the config at boot and exposes it by key", () => {
    const config = mockedConfig();

    const catalog = buildModelCatalog(config, [mock]);

    const sonnet = catalog.get("sonnet");
    expect(sonnet.languageModel).toBe(mocks["anthropic/claude-sonnet-4.5"]);
    expect(sonnet.config).toBe(config.models.sonnet);
    expect(sonnet.optionsNamespace).toBe("mock");
  });

  it("refuses an unknown model key", () => {
    const catalog = buildModelCatalog(mockedConfig(), [mock]);

    expect(() => catalog.get("ghost")).toThrow(/ghost/);
  });

  it("aborts the boot when a provider type has no factory (criterion 1)", () => {
    const err = bootErrorOf(() => buildModelCatalog(mockedConfig(), []));

    expect(err.issues).toEqual([
      { path: "providers.openrouter.type", message: expect.stringContaining("mock") },
    ]);
  });

  it("aborts the boot when the registry cannot resolve a modelId (criterion 2)", () => {
    const config = mockedConfig((c) => {
      c.models.mini.modelId = "openai/does-not-exist";
    });

    const err = bootErrorOf(() => buildModelCatalog(config, [mock]));

    expect(err.issues.map((issue) => issue.path)).toEqual(["models.mini.modelId"]);
    expect(err.issues[0]?.message).toContain("openai/does-not-exist");
  });

  it("validates providers.<id>.options with the factory schema", () => {
    const strict: ProviderFactory<{ region: string }> = {
      type: "mock",
      optionsNamespace: "mock",
      optionsSchema: z.strictObject({ region: z.string() }),
      create: () => customProvider({ languageModels: mocks }),
    };
    const config = mockedConfig((c) => {
      c.providers.openrouter.options = { region: 42 };
    });

    const err = bootErrorOf(() => buildModelCatalog(config, [strict]));

    expect(err.issues.map((issue) => issue.path)).toEqual(["providers.openrouter.options.region"]);
  });

  it("hands the factory the resolved key, baseURL and headers, and the validated options", () => {
    const seen: unknown[] = [];
    const spy: ProviderFactory = {
      type: "mock",
      optionsNamespace: "mock",
      optionsSchema: z.strictObject({}),
      create(input) {
        seen.push(input);
        return customProvider({ languageModels: mocks });
      },
    };
    const config = testConfig(
      (c) => {
        c.providers.openrouter.type = "mock";
      },
      ["mock"],
    );

    buildModelCatalog(config, [spy]);

    expect(seen).toEqual([
      {
        apiKey: "provider-key-sentinel",
        baseURL: "https://openrouter.ai/api/v1",
        headers: { "HTTP-Referer": "https://anthology.interno", "X-Title": "Anthology" },
        options: {},
      },
    ]);
  });
});
