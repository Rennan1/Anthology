import { z } from "zod";
import type { GatewayResponseFormat } from "../../routing/gateway.types.js";
import { fail, parse } from "./parse.js";

const KindSchema = z.looseObject({ type: z.string() });
const JsonSchemaFormat = z.looseObject({
  json_schema: z.looseObject({
    name: z.string().min(1),
    description: z.string().nullish(),
    schema: z.record(z.string(), z.unknown()),
  }),
});

/**
 * SPEC-005: OpenAI `response_format`. `strict` is dropped on purpose: the guarantee is the
 * provider's, and the gateway does not validate the generated JSON in v1.
 */
export function translateResponseFormat(raw: unknown): GatewayResponseFormat | undefined {
  if (raw === undefined || raw === null) return undefined;
  const { type } = parse(KindSchema, raw, ["response_format"]);
  switch (type) {
    case "text":
      return undefined;
    case "json_object":
      return { type: "json_object" };
    case "json_schema": {
      const { name, description, schema } = parse(JsonSchemaFormat, raw, [
        "response_format",
      ]).json_schema;
      return {
        type: "json_schema",
        name,
        ...(description != null && { description }),
        schema,
      };
    }
    default:
      throw fail("invalid_request", `Unknown response_format type '${type}'`, [
        "response_format",
        "type",
      ]);
  }
}
