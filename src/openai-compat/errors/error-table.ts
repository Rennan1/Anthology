import type { GatewayErrorCode } from "../../routing/gateway-error.js";

export type ErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "rate_limit_error"
  | "api_error";

// SPEC-001, seção "Erros". upstream_rejected: o status aqui é o fallback; o real vem de upstreamStatus.
export const ERROR_TABLE: Record<GatewayErrorCode, { status: number; type: ErrorType }> = {
  invalid_request: { status: 400, type: "invalid_request_error" },
  unsupported_parameter: { status: 400, type: "invalid_request_error" },
  unsupported_capability: { status: 400, type: "invalid_request_error" },
  invalid_api_key: { status: 401, type: "authentication_error" },
  model_not_found: { status: 404, type: "invalid_request_error" },
  request_too_large: { status: 413, type: "invalid_request_error" },
  upstream_rate_limited: { status: 429, type: "rate_limit_error" },
  upstream_unavailable: { status: 502, type: "api_error" },
  upstream_timeout: { status: 504, type: "api_error" },
  upstream_rejected: { status: 400, type: "invalid_request_error" },
  internal_error: { status: 500, type: "api_error" },
};
