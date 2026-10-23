import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { testConfig } from "../test/support/config-fixture.js";
import {
  mockProviderFactory,
  scriptedProviderFactory,
} from "../test/support/mock-provider-factory.js";
import { scriptedModel, textReply } from "../test/support/scripted-model.js";
import { GATEWAY_CONFIG } from "./config/config.module.js";
import { ConfigError } from "./config/config-error.js";
import { providerFactories } from "./providers/provider-factories.js";
import type { ProviderFactory } from "./providers/provider-factory.js";
import { ProvidersModule } from "./providers/providers.module.js";
import { CHAT_ROUTER, type ChatRouter, type GatewayRequest } from "./routing/gateway.types.js";
import { RoutingModule } from "./routing/routing.module.js";

const SONNET = "anthropic/claude-sonnet-4.5";
const request: GatewayRequest = {
  model: "code",
  continuationRoute: undefined,
  messages: [{ role: "user", content: "oi" }],
  params: {},
  tools: undefined,
  toolChoice: undefined,
  parallelToolCalls: undefined,
  responseFormat: undefined,
  endUser: undefined,
};

function mockedConfig(types: readonly string[]) {
  return testConfig((c) => {
    c.providers.openrouter.type = "mock";
    delete c.providers.openrouter.baseURL;
    c.models.sonnet.providerOptions = { provider: { order: ["anthropic"] } };
  }, types);
}

async function routerWith(factories: readonly ProviderFactory[]) {
  const config = mockedConfig(factories.map((factory) => factory.type));
  @Global()
  @Module({ providers: [{ provide: GATEWAY_CONFIG, useValue: config }], exports: [GATEWAY_CONFIG] })
  class StandInConfigModule {}
  const moduleRef = await Test.createTestingModule({
    imports: [StandInConfigModule, ProvidersModule.forRoot({ factories }), RoutingModule],
  }).compile();
  return moduleRef.get<ChatRouter>(CHAT_ROUTER);
}

// Composition of ProvidersModule with RoutingModule: neither may import the other, so the test lives above both.
describe("ProvidersModule + RoutingModule", () => {
  it("delivers providerOptions to the model exactly under the factory namespace (criterion 3)", async () => {
    const sonnet = scriptedModel(textReply("ok"));
    const mock = mockProviderFactory({
      [SONNET]: sonnet,
      "google/gemini-2.5-flash": scriptedModel(),
      "openai/gpt-5-mini": scriptedModel(),
    });
    const router = await routerWith(providerFactories([mock]));

    const result = await router.complete(
      request,
      { keyId: "app-backoffice" },
      new AbortController().signal,
    );

    expect(result.modelKey).toBe("sonnet");
    expect(sonnet.doGenerateCalls[0]?.providerOptions).toEqual({
      mock: { provider: { order: ["anthropic"] } },
    });
  });

  it("rejects type mock at boot when nobody registered the mock factory", () => {
    const registered = providerFactories().map((factory) => factory.type);

    expect(registered).toEqual(["openrouter"]);
    expect(() => mockedConfig(registered)).toThrow(ConfigError);
    expect(() => mockedConfig(registered)).toThrow(/providers\.openrouter\.type/);
  });

  it("takes a new provider type with no change outside src/providers (criterion 6)", async () => {
    const openAiCompatible = scriptedProviderFactory("mock", "openai-compatible", {
      [SONNET]: scriptedModel(textReply("via compatível")),
      "google/gemini-2.5-flash": scriptedModel(),
      "openai/gpt-5-mini": scriptedModel(),
    });
    const router = await routerWith(providerFactories([openAiCompatible]));

    const result = await router.complete(
      request,
      { keyId: "app-backoffice" },
      new AbortController().signal,
    );

    expect(result.text).toBe("via compatível");
  });
});
