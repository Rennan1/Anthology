/** Id reservado: entrega a escolha da Rota ao orquestrador (SPEC-009). */
export const AUTO_MODEL_ID = "auto";

export type RoutedBy = "client" | "orchestrator" | "continuation" | "single_option" | "default";

export type GatewayFinishReason =
  | "stop"
  | "length"
  | "tool-calls"
  | "content-filter"
  | "error"
  | "other"
  | "unknown";

export interface GatewayCaller {
  readonly keyId: string;
}

export interface GenerationParams {
  readonly temperature?: number;
  readonly topP?: number;
  readonly seed?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly stop?: readonly string[];
  readonly maxOutputTokens?: number;
}

/**
 * Requisição já validada e livre de formato OpenAI. `messages`, `tools`, `toolChoice` e
 * `responseFormat` seguem como vieram: a tradução para o AI SDK é da SPEC-005.
 */
export interface GatewayRequest {
  readonly model: string;
  /** Rota devolvida pelo cliente em `x-anthology-route` (continuação, SPEC-009). */
  readonly continuationRoute: string | undefined;
  readonly messages: readonly unknown[];
  readonly params: GenerationParams;
  readonly tools: readonly unknown[] | undefined;
  readonly toolChoice: unknown;
  readonly parallelToolCalls: boolean | undefined;
  readonly responseFormat: unknown;
  readonly endUser: string | undefined;
}

export interface GatewayToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface GatewayUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface GatewayResult {
  readonly text: string;
  readonly toolCalls: readonly GatewayToolCall[];
  readonly finishReason: GatewayFinishReason;
  readonly usage: GatewayUsage;
  /** Rota resolvida e quem a escolheu. */
  readonly route: string;
  readonly routedBy: RoutedBy;
  /** Id, na configuração, do Modelo que atendeu (o do fallback quando o primário falhou). */
  readonly modelKey: string;
  readonly attempts: number;
}

/** Porta do roteamento (SPEC-003/009); implementada no marco do roteamento. */
export interface ChatRouter {
  complete(
    request: GatewayRequest,
    caller: GatewayCaller,
    signal: AbortSignal,
  ): Promise<GatewayResult>;
}
export const CHAT_ROUTER = Symbol("CHAT_ROUTER");

/** Porta de leitura das Rotas visíveis à chave (SPEC-003/007). */
export interface RouteCatalog {
  visibleRouteIds(caller: GatewayCaller): readonly string[];
}
export const ROUTE_CATALOG = Symbol("ROUTE_CATALOG");
