import type { LanguageModel } from "ai";
import type { ModelConfig } from "../config/gateway-config.js";

export interface CatalogModel {
  readonly languageModel: LanguageModel;
  readonly config: ModelConfig;
  /** Key of this provider's options in the AI SDK `providerOptions` (SPEC-004). */
  readonly optionsNamespace: string;
}

/** What routing sees of the provider layer: it never touches the registry or a factory. */
export interface ModelCatalog {
  get(modelKey: string): CatalogModel;
}
export const MODEL_CATALOG = Symbol("MODEL_CATALOG");
