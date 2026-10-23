import type { GatewayResult } from "../../routing/gateway.types.js";

export function buildGatewayHeaders(result: GatewayResult): Record<string, string> {
  return {
    "x-anthology-route": result.route,
    "x-anthology-routed-by": result.routedBy,
    "x-anthology-model": result.modelKey,
    "x-anthology-attempts": String(result.attempts),
  };
}
