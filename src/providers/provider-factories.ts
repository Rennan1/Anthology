import { openRouterFactory } from "./openrouter/openrouter.factory.js";
import type { ProviderFactory } from "./provider-factory.js";

/**
 * Every provider type the gateway knows. A new provider is one file plus one line here
 * (`extra` is how tests add the `mock` provider; production passes nothing).
 */
export function providerFactories(extra: readonly ProviderFactory[] = []): ProviderFactory[] {
  return [openRouterFactory, ...extra];
}
