import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import type { ProviderFactory } from "../provider-factory.js";

/** The only file that imports the OpenRouter package (dependency-cruiser: openrouter-confinado). */
export const openRouterFactory: ProviderFactory<Record<string, never>> = {
  type: "openrouter",
  optionsNamespace: "openrouter",
  optionsSchema: z.strictObject({}),
  create: ({ apiKey, baseURL, headers }) =>
    createOpenRouter({
      apiKey,
      // The package asks for `strict` against the real OpenRouter API (`compatible` omits
      // stream_options, which the usage chunk of SPEC-006 needs).
      compatibility: "strict",
      ...(baseURL !== undefined && { baseURL }),
      ...(headers !== undefined && { headers }),
    }),
};
