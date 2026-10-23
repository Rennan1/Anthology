/** Códigos da tabela de erros da SPEC-001. O mapa código → HTTP vive em openai-compat (o roteamento não conhece HTTP). */
export type GatewayErrorCode =
  | "invalid_request"
  | "unsupported_parameter"
  | "unsupported_capability"
  | "invalid_api_key"
  | "model_not_found"
  | "unknown_url"
  | "request_too_large"
  | "upstream_rate_limited"
  | "upstream_unavailable"
  | "upstream_timeout"
  | "upstream_rejected"
  | "internal_error";

export interface GatewayErrorOptions {
  /** Caminho do campo da requisição que causou o erro (`n`, `messages[2].tool_calls[0]…`). */
  readonly param?: string;
  /** Só para `upstream_rejected`: o status que o upstream devolveu e que o cliente verá. */
  readonly upstreamStatus?: number;
  readonly cause?: unknown;
}

export class GatewayError extends Error {
  readonly param: string | null;
  readonly upstreamStatus: number | undefined;

  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    options: GatewayErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GatewayError";
    this.param = options.param ?? null;
    this.upstreamStatus = options.upstreamStatus;
  }
}
