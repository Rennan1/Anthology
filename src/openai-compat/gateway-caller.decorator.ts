import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { GatewayCaller } from "../routing/gateway.types.js";
import { GatewayError } from "../routing/gateway-error.js";

/** O guard de chave (SPEC-007) põe o chamador na requisição; sem ele a rota fecha, não abre. */
export const Caller = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<{ gatewayCaller?: GatewayCaller }>();
  if (request.gatewayCaller === undefined) {
    throw new GatewayError("invalid_api_key", "Missing or invalid API key.");
  }
  return request.gatewayCaller;
});
