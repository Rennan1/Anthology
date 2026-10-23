import type { z } from "zod";
import { formatJsonPath } from "../../common/json-path.js";
import { GatewayError, type GatewayErrorCode } from "../../routing/gateway-error.js";

export type Path = readonly PropertyKey[];

/** A request-shape error carrying the OpenAI-style path of the offending field in `param`. */
export function fail(code: GatewayErrorCode, message: string, path: Path): GatewayError {
  return new GatewayError(code, message, { param: formatJsonPath(path) });
}

/** Validates an external value; the first issue becomes an `invalid_request` at its path. */
export function parse<T>(schema: z.ZodType<T>, value: unknown, base: Path): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw fail("invalid_request", issue?.message ?? "Invalid value", [
    ...base,
    ...(issue?.path ?? []),
  ]);
}
