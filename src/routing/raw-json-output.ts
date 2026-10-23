import type { JSONSchema7, OutputInterface } from "ai";
import type { GatewayResponseFormat } from "./gateway.types.js";

/**
 * SPEC-005 / Q-07. Asks the provider for JSON (with the schema, when there is one) but returns the
 * text as it came. The AI SDK's own `Output.object` parses and validates eagerly and throws
 * `NoObjectGeneratedError` on invalid or truncated JSON, which would turn a `length` finish into
 * an error; the gateway promises only what the provider guarantees (`strict`), so it validates nothing.
 */
export function rawJsonOutput(
  format: GatewayResponseFormat,
): OutputInterface<string, string, never> {
  const responseFormat =
    format.type === "json_object"
      ? ({ type: "json" } as const)
      : ({
          type: "json",
          schema: format.schema as JSONSchema7,
          name: format.name,
          ...(format.description !== undefined && { description: format.description }),
        } as const);
  return {
    name: format.type,
    responseFormat: Promise.resolve(responseFormat),
    parseCompleteOutput: async ({ text }) => text,
    parsePartialOutput: async () => undefined,
    createElementStreamTransform: () => undefined,
  };
}
