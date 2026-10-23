import type { ModelConfig, RouteConfig } from "../config/gateway-config.js";
import type { GenerationParams } from "./gateway.types.js";

/** The AI SDK call options this module owns. */
export interface CallParams {
  temperature?: number;
  topP?: number;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  maxOutputTokens?: number;
}

type Layer = GenerationParams | NonNullable<ModelConfig["defaults"]> | undefined;

/** Later layers win, but an absent key never erases an earlier value. */
function overlay(base: Record<string, unknown>, layer: Layer): void {
  for (const [key, value] of Object.entries(layer ?? {})) {
    if (value !== undefined) base[key] = value;
  }
}

/**
 * SPEC-003: model defaults < route defaults < request < route enforce, then the model's
 * maxOutputTokens is a ceiling. Rerun per candidate: a fallback has its own defaults and ceiling.
 */
export function mergeParams(input: {
  model: ModelConfig;
  route: RouteConfig;
  request: GenerationParams;
}): CallParams {
  const merged: Record<string, unknown> = {};
  overlay(merged, input.model.defaults);
  overlay(merged, input.route.defaults);
  overlay(merged, input.request);
  overlay(merged, input.route.enforce);

  const { stop, ...rest } = merged;
  const params: CallParams = {
    ...rest,
    ...(stop !== undefined && { stopSequences: stop as string[] }),
  };
  const ceiling = input.model.maxOutputTokens;
  if (ceiling !== undefined && params.maxOutputTokens !== undefined) {
    params.maxOutputTokens = Math.min(params.maxOutputTokens, ceiling);
  }
  return params;
}
