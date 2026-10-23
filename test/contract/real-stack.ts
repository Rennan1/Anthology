import {
  type CanActivate,
  type ExecutionContext,
  Global,
  Injectable,
  Module,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { MockLanguageModelV4 } from "ai/test";
import OpenAI from "openai";
import { GATEWAY_CONFIG } from "../../src/config/config.module.js";
import { configureJsonBody } from "../../src/openai-compat/json-body.js";
import { OpenAiCompatModule } from "../../src/openai-compat/openai-compat.module.js";
import { providerFactories } from "../../src/providers/provider-factories.js";
import { ProvidersModule } from "../../src/providers/providers.module.js";
import type { GatewayCaller } from "../../src/routing/gateway.types.js";
import { RoutingModule } from "../../src/routing/routing.module.js";
import { testConfig } from "../support/config-fixture.js";
import { mockProviderFactory } from "../support/mock-provider-factory.js";

const KEY = "sk-test";

/** The upstream `modelId` of each model of the example config. */
export const UPSTREAM = {
  sonnet: "anthropic/claude-sonnet-4.5",
  flash: "google/gemini-2.5-flash",
  mini: "openai/gpt-5-mini",
} as const;

@Injectable()
class StandInAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; gatewayCaller?: GatewayCaller }>();
    req.gatewayCaller = { keyId: "app-backoffice" };
    return req.headers.authorization === `Bearer ${KEY}`;
  }
}

/**
 * The whole gateway minus auth (SPEC-007) and the app shell: parse and translate, routing,
 * catalog, and scripted mock models behind a real HTTP server, called by the official SDK.
 */
export async function startRealStack(models: Record<keyof typeof UPSTREAM, MockLanguageModelV4>) {
  const config = testConfig(
    (c) => {
      c.providers.openrouter.type = "mock";
      delete c.providers.openrouter.baseURL;
    },
    ["mock"],
  );
  const mock = mockProviderFactory({
    [UPSTREAM.sonnet]: models.sonnet,
    [UPSTREAM.flash]: models.flash,
    [UPSTREAM.mini]: models.mini,
  });

  @Global()
  @Module({
    providers: [
      { provide: GATEWAY_CONFIG, useValue: config },
      { provide: APP_GUARD, useClass: StandInAuthGuard },
    ],
    exports: [GATEWAY_CONFIG],
  })
  class StandInConfigModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [
      StandInConfigModule,
      ProvidersModule.forRoot({ factories: providerFactories([mock]) }),
      RoutingModule,
      OpenAiCompatModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureJsonBody(app, 1024 * 1024);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as { port: number };
  const client = new OpenAI({
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: KEY,
    maxRetries: 0,
  });
  return { app, client };
}
