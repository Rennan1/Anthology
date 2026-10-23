import type { NestExpressApplication } from "@nestjs/platform-express";
import { requestIdMiddleware } from "./request-id.middleware.js";

/**
 * O padrão do Nest (100kb) é pouco para prompts. Requer `createNestApplication({ bodyParser: false })`.
 * O x-request-id entra antes do body-parser, senão o 400/413 dele sairia sem o header.
 */
export function configureJsonBody(app: NestExpressApplication, limitBytes: number): void {
  app.use(requestIdMiddleware);
  app.useBodyParser("json", { limit: limitBytes });
}
