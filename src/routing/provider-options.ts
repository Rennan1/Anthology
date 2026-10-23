import type { generateText } from "ai";
import type { CatalogModel } from "../providers/model-catalog.js";

export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

export interface BuiltProviderOptions {
  readonly options: ProviderOptions | undefined;
  /** Request parameters this candidate cannot honor, for the log. */
  readonly ignoredParams: readonly string[];
}

/**
 * `providerOptions` of one candidate: the model's own (SPEC-004) plus, when the client sent
 * `parallel_tool_calls` and the factory declares where it goes, that switch (SPEC-005).
 */
export function buildProviderOptions(
  model: CatalogModel,
  parallelToolCalls: boolean | undefined,
): BuiltProviderOptions {
  const own = model.config.providerOptions;
  const ignoredParams: string[] = [];
  let merged = own;
  if (parallelToolCalls !== undefined) {
    if (model.parallelToolCallsOption === undefined) ignoredParams.push("parallel_tool_calls");
    else merged = { ...own, [model.parallelToolCallsOption]: parallelToolCalls };
  }
  return {
    options:
      merged === undefined ? undefined : ({ [model.optionsNamespace]: merged } as ProviderOptions),
    ignoredParams,
  };
}
