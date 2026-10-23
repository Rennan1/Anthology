import { createProviderRegistry } from "ai";
import { ConfigError, type ConfigIssue } from "../config/config-error.js";
import type { GatewayConfig } from "../config/gateway-config.js";
import { formatJsonPath } from "../config/json-path.js";
import type { CatalogModel, ModelCatalog } from "./model-catalog.js";
import type { AiSdkProvider, ProviderFactory } from "./provider-factory.js";

interface BuiltProvider {
  readonly provider: AiSdkProvider;
  readonly optionsNamespace: string;
}

function buildProviders(
  config: GatewayConfig,
  factories: readonly ProviderFactory[],
  issues: ConfigIssue[],
): Map<string, BuiltProvider> {
  const byType = new Map(factories.map((factory) => [factory.type, factory]));
  const built = new Map<string, BuiltProvider>();
  for (const [id, entry] of Object.entries(config.providers)) {
    const factory = byType.get(entry.type);
    if (factory === undefined) {
      issues.push({
        path: formatJsonPath(["providers", id, "type"]),
        message: `no factory registered for provider type '${entry.type}'`,
      });
      continue;
    }
    const options = factory.optionsSchema.safeParse(entry.options ?? {});
    if (!options.success) {
      for (const issue of options.error.issues) {
        issues.push({
          path: formatJsonPath(["providers", id, "options", ...issue.path]),
          message: issue.message,
        });
      }
      continue;
    }
    const provider = factory.create({
      apiKey: entry.apiKey,
      ...(entry.baseURL !== undefined && { baseURL: entry.baseURL }),
      ...(entry.headers !== undefined && { headers: entry.headers }),
      options: options.data,
    });
    built.set(id, { provider, optionsNamespace: factory.optionsNamespace });
  }
  return built;
}

/**
 * SPEC-004 boot: providers from their factories, one registry, and every configured model
 * resolved now, so a bad reference fails the boot instead of the first request.
 */
export function buildModelCatalog(
  config: GatewayConfig,
  factories: readonly ProviderFactory[],
): ModelCatalog {
  const issues: ConfigIssue[] = [];
  const providers = buildProviders(config, factories, issues);
  const registry = createProviderRegistry(
    Object.fromEntries([...providers].map(([id, built]) => [id, built.provider])),
  );

  const models = new Map<string, CatalogModel>();
  for (const [modelKey, model] of Object.entries(config.models)) {
    const built = providers.get(model.provider);
    if (built === undefined) continue; // the provider's own error is already reported
    try {
      const languageModel = registry.languageModel(
        `${model.provider}:${model.modelId}` as `${string}:${string}`,
      );
      models.set(modelKey, {
        languageModel,
        config: model,
        optionsNamespace: built.optionsNamespace,
      });
    } catch {
      issues.push({
        path: formatJsonPath(["models", modelKey, "modelId"]),
        message: `provider '${model.provider}' cannot resolve model '${model.modelId}'`,
      });
    }
  }
  if (issues.length > 0) throw new ConfigError(issues);

  return {
    get(modelKey) {
      const model = models.get(modelKey);
      if (model === undefined) throw new Error(`Unknown model '${modelKey}'`);
      return model;
    },
  };
}
