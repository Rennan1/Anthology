import type { Capability } from "../config/capabilities.js";
import type { GatewayRequest } from "./gateway.types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasImagePart(messages: readonly unknown[]): boolean {
  return messages.some(
    (message) =>
      isRecord(message) &&
      Array.isArray(message.content) &&
      message.content.some((part) => isRecord(part) && part.type === "image"),
  );
}

/** SPEC-003: what the request demands of a candidate, in a stable order. */
export function requiredCapabilities(request: GatewayRequest): Capability[] {
  const required: Capability[] = [];
  if (request.tools !== undefined && request.tools.length > 0) required.push("tools");
  if (hasImagePart(request.messages)) required.push("vision");
  if (isRecord(request.responseFormat) && request.responseFormat.type === "json_schema") {
    required.push("json_schema");
  }
  return required;
}

export function missingCapabilities(
  model: { readonly capabilities: readonly Capability[] },
  required: readonly Capability[],
): Capability[] {
  return required.filter((capability) => !model.capabilities.includes(capability));
}
