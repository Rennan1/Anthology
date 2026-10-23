import { z } from "zod";
import { ConfigFileSchema } from "./config-schema.js";

/** Editor autocomplete schema: `input` mode, so fields with defaults stay optional. */
export function buildConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ConfigFileSchema, { io: "input" });
}
