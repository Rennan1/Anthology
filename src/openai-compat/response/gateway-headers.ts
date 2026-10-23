import type { GatewayResult } from "../../routing/gateway.types.js";

/** The headers of SPEC-001; a complete result and a committed stream both carry these four. */
export function buildGatewayHeaders(
  result: Pick<GatewayResult, "route" | "routedBy" | "modelKey" | "attempts">,
): Record<string, string> {
  return {
    "x-anthology-route": result.route,
    "x-anthology-routed-by": result.routedBy,
    "x-anthology-model": result.modelKey,
    "x-anthology-attempts": String(result.attempts),
  };
}
