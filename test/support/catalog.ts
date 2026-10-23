import type { MockLanguageModelV4 } from "ai/test";
import type { GatewayConfig } from "../../src/config/gateway-config.js";
import type { ModelCatalog } from "../../src/providers/model-catalog.js";

/** A ModelCatalog backed by scripted mocks, keyed by the model keys of the config. */
export function mockCatalog(
  config: GatewayConfig,
  models: Record<string, MockLanguageModelV4>,
  options: { parallelToolCallsOption?: string } = {},
): ModelCatalog {
  return {
    get(modelKey) {
      const languageModel = models[modelKey];
      const modelConfig = config.models[modelKey];
      if (languageModel === undefined || modelConfig === undefined) {
        throw new Error(`mockCatalog: no mock for model '${modelKey}'`);
      }
      return {
        languageModel,
        config: modelConfig,
        optionsNamespace: "openrouter",
        ...(options.parallelToolCallsOption !== undefined && {
          parallelToolCallsOption: options.parallelToolCallsOption,
        }),
      };
    },
  };
}
