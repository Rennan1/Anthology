import { HttpException } from "@nestjs/common";
import { GatewayError, type GatewayErrorCode } from "../../routing/gateway-error.js";
import { ERROR_TABLE } from "./error-table.js";

export interface ErrorResponse {
  status: number;
  body: { error: { message: string; type: string; param: string | null; code: string } };
}

const GENERIC_INTERNAL_MESSAGE = "The server had an error while processing your request.";

function build(
  code: GatewayErrorCode,
  message: string,
  param: string | null,
  status?: number,
): ErrorResponse {
  const row = ERROR_TABLE[code];
  return {
    status: status ?? row.status,
    body: { error: { message, type: row.type, param, code } },
  };
}

// SPEC-001: o status de upstream_rejected é o do upstream, mas só se for 4xx; senão 400.
function upstreamRejectedStatus(upstreamStatus: number | undefined): number {
  const isClientError =
    upstreamStatus !== undefined &&
    Number.isInteger(upstreamStatus) &&
    upstreamStatus >= 400 &&
    upstreamStatus < 500;
  return isClientError ? upstreamStatus : ERROR_TABLE.upstream_rejected.status;
}

function bodyParserType(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("type" in err)) return undefined;
  return typeof err.type === "string" ? err.type : undefined;
}

function isClientErrorStatus(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("status" in err)) return false;
  return typeof err.status === "number" && err.status >= 400 && err.status < 500;
}

// Mensagens fixas: err.message de terceiros (body-parser, Nest) pode ecoar o corpo do cliente.
function fromFramework(err: unknown): ErrorResponse | undefined {
  const parserType = bodyParserType(err);
  const status = err instanceof HttpException ? err.getStatus() : undefined;
  if (parserType === "entity.too.large" || status === 413) {
    return build("request_too_large", "Request body exceeds the size limit.", null);
  }
  if (parserType === "entity.parse.failed") {
    return build("invalid_request", "Request body is not valid JSON.", null);
  }
  // Outro 4xx do body-parser (415 de charset/encoding...) ou 400 do Nest, sem linha própria na tabela.
  if (status === 400 || (parserType !== undefined && isClientErrorStatus(err))) {
    return build("invalid_request", "The request could not be understood.", null);
  }
  if (status === 404) {
    return build("unknown_url", "Unknown request URL.", null);
  }
  return undefined;
}

export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof GatewayError) {
    const status =
      err.code === "upstream_rejected" ? upstreamRejectedStatus(err.upstreamStatus) : undefined;
    return build(err.code, err.message, err.param, status);
  }
  // Qualquer outro erro (inclusive HttpException fora de 400/404/413, sem linha na tabela da SPEC) vira 500 genérico.
  return fromFramework(err) ?? build("internal_error", GENERIC_INTERNAL_MESSAGE, null);
}
