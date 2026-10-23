import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from "@nestjs/common";
import type { Response } from "express";
import { GatewayError } from "../../routing/gateway-error.js";
import { toErrorResponse } from "./to-error-response.js";

@Catch()
export class GatewayExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GatewayExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = toErrorResponse(exception);
    // Só o log vê o erro inesperado (com stack); a resposta é sempre a genérica.
    if (!(exception instanceof GatewayError) && status === 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : "non-Error exception",
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
