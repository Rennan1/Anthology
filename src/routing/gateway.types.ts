import type { ModelMessage, TextStreamPart, ToolChoice, ToolSet } from "ai";

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

/** Saída estruturada pedida (SPEC-005); o roteamento a converte para a chamada do AI SDK. */
export type GatewayResponseFormat =
  | { readonly type: "json_object" }
  | {
      readonly type: "json_schema";
      readonly name: string;
      readonly description?: string;
      readonly schema: Readonly<Record<string, unknown>>;
    };

/**
 * Requisição já validada, livre de formato OpenAI e já traduzida para o AI SDK (SPEC-005):
 * `openai-compat/translate` produz `messages`, `tools` e `toolChoice`; o roteamento só os repassa.
 */
export interface GatewayRequest {
  readonly model: string;
  /** Rota devolvida pelo cliente em `x-anthology-route` (continuação, SPEC-009). */
  readonly continuationRoute: string | undefined;
  readonly messages: readonly ModelMessage[];
  readonly params: GenerationParams;
  readonly tools: ToolSet | undefined;
  readonly toolChoice: ToolChoice<ToolSet> | undefined;
  readonly parallelToolCalls: boolean | undefined;
  readonly responseFormat: GatewayResponseFormat | undefined;
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
  /** Cached input tokens, when the provider says (SPEC-005). */
  readonly cachedPromptTokens?: number;
  /** Reasoning output tokens, when the provider says (SPEC-005). */
  readonly reasoningTokens?: number;
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
  /** The provider sent no usage at all: the zeros in `usage` are not a measurement (SPEC-005). */
  readonly usageMissing?: true;
  /** The provider's own finish reason, kept for the log when the mapping loses it (SPEC-005). */
  readonly finishReasonRaw?: string;
}

/**
 * Resposta em stream, já commitada (SPEC-003/006): `parts` continua o stream do provedor a partir
 * da primeira parte. Erro depois do commit chega como parte `error`, nunca como exceção.
 */
export interface GatewayStream {
  readonly route: string;
  readonly routedBy: RoutedBy;
  readonly modelKey: string;
  readonly attempts: number;
  readonly parts: AsyncIterable<TextStreamPart<ToolSet>>;
}

/** Porta do roteamento (SPEC-003/009); implementada no marco do roteamento. */
export interface ChatRouter {
  complete(
    request: GatewayRequest,
    caller: GatewayCaller,
    signal: AbortSignal,
  ): Promise<GatewayResult>;
  /** Resolve no ponto de commit; antes dele, falha do candidato vai ao fallback ou propaga. */
  stream(
    request: GatewayRequest,
    caller: GatewayCaller,
    signal: AbortSignal,
  ): Promise<GatewayStream>;
}
export const CHAT_ROUTER = Symbol("CHAT_ROUTER");

/** Porta de leitura das Rotas visíveis à chave (SPEC-003/007). */
export interface RouteCatalog {
  visibleRouteIds(caller: GatewayCaller): readonly string[];
}
export const ROUTE_CATALOG = Symbol("ROUTE_CATALOG");
