import type { Capability } from "../config/capabilities.js";
import type { GatewayConfig, RouteConfig } from "../config/gateway-config.js";
import type { CatalogModel, ModelCatalog } from "../providers/model-catalog.js";
import { missingCapabilities, requiredCapabilities } from "./capabilities.js";
import {
  AUTO_MODEL_ID,
  type GatewayCaller,
  type GatewayRequest,
  type RoutedBy,
} from "./gateway.types.js";
import { GatewayError } from "./gateway-error.js";

export interface PlannedCandidate {
  readonly modelKey: string;
  readonly model: CatalogModel;
}

export interface SkippedCandidate {
  readonly model: string;
  readonly reason: "missing_capability";
  readonly missing: readonly Capability[];
}

export interface RoutePlan {
  readonly routeId: string;
  readonly routedBy: RoutedBy;
  readonly route: RouteConfig;
  readonly candidates: readonly PlannedCandidate[];
  readonly skipped: readonly SkippedCandidate[];
}

/** Routes the key may use, in config order (SPEC-007 permission, applied at resolution). */
export function visibleRouteIds(config: GatewayConfig, caller: GatewayCaller): string[] {
  const key = config.auth.keys.find((candidate) => candidate.id === caller.keyId);
  if (key === undefined) return [];
  return Object.keys(config.routes).filter(
    (routeId) => key.routes.includes("*") || key.routes.includes(routeId),
  );
}

function chainOf(route: RouteConfig): string[] {
  return [route.target, ...route.fallbacks];
}

function isCapable(config: GatewayConfig, route: RouteConfig, required: readonly Capability[]) {
  return chainOf(route).some((modelKey) => {
    const model = config.models[modelKey];
    return model !== undefined && missingCapabilities(model, required).length === 0;
  });
}

function endsWithToolResult(messages: readonly unknown[]): boolean {
  const last = messages.at(-1);
  return typeof last === "object" && last !== null && "role" in last && last.role === "tool";
}

/** SPEC-009 steps 2-4 without the orchestrator model: it joins with SPEC-009. */
function chooseAmongEligible(
  request: GatewayRequest,
  config: GatewayConfig,
  eligible: readonly string[],
): { routeId: string; routedBy: RoutedBy } {
  const { continuationRoute } = request;
  if (
    continuationRoute !== undefined &&
    endsWithToolResult(request.messages) &&
    eligible.includes(continuationRoute)
  ) {
    return { routeId: continuationRoute, routedBy: "continuation" };
  }
  const [first] = eligible;
  if (eligible.length === 1 && first !== undefined) {
    return { routeId: first, routedBy: "single_option" };
  }
  const { defaultRoute } = config.orchestrator;
  const fallback = eligible.includes(defaultRoute) ? defaultRoute : first;
  if (fallback === undefined) throw new Error("unreachable: eligible is not empty");
  return { routeId: fallback, routedBy: "default" };
}

function unsupportedCapability(subject: string, required: readonly Capability[]): GatewayError {
  return new GatewayError(
    "unsupported_capability",
    `No model of ${subject} supports what the request needs: ${required.join(", ")}.`,
  );
}

function resolveRoute(
  request: GatewayRequest,
  caller: GatewayCaller,
  config: GatewayConfig,
  required: readonly Capability[],
): { routeId: string; routedBy: RoutedBy } {
  const allowed = visibleRouteIds(config, caller);
  if (request.model !== AUTO_MODEL_ID) {
    if (!allowed.includes(request.model)) {
      throw new GatewayError("model_not_found", `The model '${request.model}' does not exist.`, {
        param: "model",
      });
    }
    return { routeId: request.model, routedBy: "client" };
  }
  const eligible = allowed.filter((routeId) => {
    const route = config.routes[routeId];
    return route !== undefined && isCapable(config, route, required);
  });
  if (eligible.length === 0)
    throw unsupportedCapability("any route available to this key", required);
  return chooseAmongEligible(request, config, eligible);
}

/** SPEC-003 steps 1-4: Route, chain, capability filter. No I/O. */
export function planRoute(input: {
  request: GatewayRequest;
  caller: GatewayCaller;
  config: GatewayConfig;
  catalog: ModelCatalog;
}): RoutePlan {
  const { request, caller, config, catalog } = input;
  const required = requiredCapabilities(request);
  const { routeId, routedBy } = resolveRoute(request, caller, config, required);
  const route = config.routes[routeId];
  if (route === undefined) throw new Error(`unreachable: route '${routeId}' vanished`);

  const candidates: PlannedCandidate[] = [];
  const skipped: SkippedCandidate[] = [];
  for (const modelKey of chainOf(route)) {
    const missing = missingCapabilities(config.models[modelKey] ?? { capabilities: [] }, required);
    if (missing.length === 0) candidates.push({ modelKey, model: catalog.get(modelKey) });
    else skipped.push({ model: modelKey, reason: "missing_capability", missing });
  }
  if (candidates.length === 0) throw unsupportedCapability(`route '${routeId}'`, required);
  return { routeId, routedBy, route, candidates, skipped };
}
