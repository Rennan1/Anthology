import type { NestExpressApplication } from "@nestjs/platform-express";

/** O padrão do Nest (100kb) é pouco para prompts. Requer `createNestApplication({ bodyParser: false })`. */
export function configureJsonBody(app: NestExpressApplication, limitBytes: number): void {
  app.useBodyParser("json", { limit: limitBytes });
}
