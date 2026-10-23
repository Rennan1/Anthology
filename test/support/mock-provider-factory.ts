import { customProvider } from "ai";
import type { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { ProviderFactory } from "../../src/providers/provider-factory.js";

/** A factory whose provider serves scripted models, keyed by the upstream `modelId` of the config. */
export function scriptedProviderFactory(
  type: string,
  optionsNamespace: string,
  models: Record<string, MockLanguageModelV4>,
): ProviderFactory {
  return {
    type,
    optionsNamespace,
    optionsSchema: z.strictObject({}),
    create: () => customProvider({ languageModels: models }),
  };
}

/**
 * The `mock` provider of SPEC-004. It lives in test/ and is injected through
 * `ProvidersModule.forRoot({ factories })`, so production never registers it and a config with
 * `type: "mock"` is rejected at boot.
 */
export function mockProviderFactory(models: Record<string, MockLanguageModelV4>): ProviderFactory {
  return scriptedProviderFactory("mock", "mock", models);
}
