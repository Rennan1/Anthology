import type { Capability } from "../config/capabilities.js";
import type { GatewayRequest } from "./gateway.types.js";

function hasImagePart(messages: GatewayRequest["messages"]): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      typeof message.content !== "string" &&
      message.content.some(
        (part) =>
          part.type === "image" || (part.type === "file" && part.mediaType.startsWith("image/")),
      ),
  );
}

/** SPEC-003: what the request demands of a candidate, in a stable order. */
export function requiredCapabilities(request: GatewayRequest): Capability[] {
  const required: Capability[] = [];
  if (request.tools !== undefined && Object.keys(request.tools).length > 0) required.push("tools");
  if (hasImagePart(request.messages)) required.push("vision");
  if (request.responseFormat?.type === "json_schema") required.push("json_schema");
  return required;
}

export function missingCapabilities(
  model: { readonly capabilities: readonly Capability[] },
  required: readonly Capability[],
): Capability[] {
  return required.filter((capability) => !model.capabilities.includes(capability));
}
