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
import OpenAI from "openai";
import { configureJsonBody } from "../../src/openai-compat/json-body.js";
import { OpenAiCompatModule } from "../../src/openai-compat/openai-compat.module.js";
import {
  CHAT_ROUTER,
  type ChatRouter,
  type GatewayCaller,
  type GatewayRequest,
  type GatewayResult,
  ROUTE_CATALOG,
  type RouteCatalog,
} from "../../src/routing/gateway.types.js";
import { GatewayError } from "../../src/routing/gateway-error.js";

export const VALID_KEY = "sk-test";

export function result(overrides: Partial<GatewayResult> = {}): GatewayResult {
  return {
    text: "olá",
    toolCalls: [],
    finishReason: "stop",
    usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    route: "code",
    routedBy: "client",
    modelKey: "sonnet",
    attempts: 1,
    ...overrides,
  };
}

/** Roteamento roteirizado: devolve (ou lança) as respostas na ordem e guarda o que recebeu. */
export class ScriptedRouter implements ChatRouter {
  readonly received: GatewayRequest[] = [];
  private script: (GatewayResult | GatewayError)[] = [];

  reply(...script: (GatewayResult | GatewayError)[]): void {
    this.script = [...script];
    this.received.length = 0;
  }

  async complete(request: GatewayRequest, _caller: GatewayCaller): Promise<GatewayResult> {
    this.received.push(request);
    const next = this.script.shift();
    if (next === undefined) throw new Error("script esgotado");
    if (next instanceof GatewayError) throw next;
    return next;
  }
}

type GuardedRequest = { headers: Record<string, string>; gatewayCaller?: GatewayCaller };

/** Faz o papel do guard da SPEC-007, que ainda não existe. */
@Injectable()
class StandInAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<GuardedRequest>();
    if (req.headers.authorization !== `Bearer ${VALID_KEY}`) {
      throw new GatewayError("invalid_api_key", "Invalid API key.");
    }
    req.gatewayCaller = { keyId: "test-key" };
    return true;
  }
}

export const router = new ScriptedRouter();
const catalog: RouteCatalog = { visibleRouteIds: () => ["code", "general"] };

const routingProviders = [
  { provide: CHAT_ROUTER, useValue: router },
  { provide: ROUTE_CATALOG, useValue: catalog },
];

@Global()
@Module({
  providers: [...routingProviders, { provide: APP_GUARD, useClass: StandInAuthGuard }],
  exports: [CHAT_ROUTER, ROUTE_CATALOG],
})
class StandInRoutingModule {}

/** Sem nenhum guard: prova que a ausência de autenticação fecha as rotas em vez de abri-las. */
@Global()
@Module({ providers: routingProviders, exports: [CHAT_ROUTER, ROUTE_CATALOG] })
class UnguardedRoutingModule {}

export async function startGateway(options: { guarded?: boolean } = {}): Promise<{
  app: NestExpressApplication;
  client: OpenAI;
  baseUrl: string;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      options.guarded === false ? UnguardedRoutingModule : StandInRoutingModule,
      OpenAiCompatModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureJsonBody(app, 1024 * 1024);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: VALID_KEY, maxRetries: 0 });
  return { app, client, baseUrl };
}
