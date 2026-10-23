import type { createProviderRegistry } from "ai";
import type { ZodType } from "zod";

/**
 * The provider type `createProviderRegistry` accepts in the pinned AI SDK. The upstream type name
 * changed between majors (ProviderV2/V3/V4), so it is derived here and named nowhere else.
 */
export type AiSdkProvider = Parameters<typeof createProviderRegistry>[0][string];

export interface ProviderFactory<Options = unknown> {
  /** Value of `providers.<id>.type` in the JSON. */
  readonly type: string;
  /** Key the AI SDK reads in `providerOptions` (e.g. "openrouter"). */
  readonly optionsNamespace: string;
  /** Validates `providers.<id>.options`; runs at boot, with SPEC-002. */
  readonly optionsSchema: ZodType<Options>;
  /** Builds the AI SDK provider. `apiKey` already comes resolved from the environment. */
  create(input: {
    apiKey: string;
    baseURL?: string;
    headers?: Record<string, string>;
    options: Options;
  }): AiSdkProvider;
}
