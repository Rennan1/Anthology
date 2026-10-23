---
id: SPEC-004
titulo: Camada de provedores
status: rascunho
adrs: [ADR-0003, ADR-0004]
requisitos: [RF-10, RF-11]
---

# SPEC-004 — Camada de provedores

## Objetivo

Definir como o gateway fala com provedores de LLM por meio do AI SDK, como o OpenRouter é integrado
e como se adiciona um provedor novo **sem tocar** em API, tradução ou roteamento
([ADR-0003](../adrs/0003-vercel-ai-sdk-como-camada-de-llm.md),
[ADR-0004](../adrs/0004-openrouter-como-provedor-oficial-inicial.md)).

## Contrato da fábrica

Cada provedor é uma **fábrica** registrada no `ProvidersModule`:

```ts
// src/providers/provider-factory.ts
export interface ProviderFactory<Options = unknown> {
  /** Valor de `providers.<id>.type` no JSON. */
  readonly type: string;
  /** Chave usada em `providerOptions` do AI SDK (ex.: "openrouter"). */
  readonly optionsNamespace: string;
  /** Valida `providers.<id>.options`; roda no boot, junto da SPEC-002. */
  readonly optionsSchema: ZodType<Options>;
  /** Cria o provider do AI SDK. `apiKey` já vem resolvida do ambiente. */
  create(input: { apiKey: string; baseURL?: string; headers?: Record<string, string>; options: Options }): AiSdkProvider;
}
```

`AiSdkProvider` é um alias local para o tipo de provider que `createProviderRegistry` aceita na
versão pinada do AI SDK. Assim, o nome do tipo upstream (que mudou entre majors) fica num lugar só.

## Montagem no boot

1. Para cada `providers.<id>`, achar a fábrica por `type` e chamar `create(...)`.
2. Montar `createProviderRegistry({ [id]: provider, ... })` com o separador padrão `:`.
3. Para cada `models.<id>`, resolver `registry.languageModel(`${provider}:${modelId}`)` **no boot**,
   para que um modelo mal referenciado falhe na subida.
4. Expor `ModelCatalog.get(modelKey)`, que devolve `{ languageModel, config, optionsNamespace }`.
   O `RoutingModule` só consome o `ModelCatalog`; ele nunca vê o registry nem uma fábrica.

### `providerOptions`

O que está em `models.<id>.providerOptions` vai na chamada como
`providerOptions: { [optionsNamespace]: models.<id>.providerOptions }`. É por aí que se liga recurso
específico de um provedor sem vazar para o roteamento. Por exemplo, no OpenRouter:
`provider.order`, `models` (fallback nativo), `reasoning`.

## Fábrica OpenRouter (oficial)

| item | valor |
|---|---|
| `type` | `openrouter` |
| pacote | `@openrouter/ai-sdk-provider` (`createOpenRouter`), versão pinada |
| `optionsNamespace` | `openrouter` |
| `baseURL` padrão | o do pacote |
| `headers` | repassados; usar `HTTP-Referer` e `X-Title` para a atribuição de app do OpenRouter |
| `options` | nenhuma na v1 (schema vazio e estrito) |

Fronteira de import: só `src/providers/openrouter/**` importa `@openrouter/ai-sdk-provider`, e uma
regra `forbidden` do dependency-cruiser (`openrouter-confinado`) garante isso no CI. A mesma regra vale para cada pacote de provedor
futuro.

## Níveis de suporte

| nível | exige |
|---|---|
| **oficial** | fábrica + testes de contrato com mock + **smoke test contra o provedor real no CI** + exemplo em `anthology.config.example.json` |
| **experimental** | fábrica + testes de contrato com mock |

O smoke test real cobre: completion simples, stream simples e um tool call. Ele roda num job do CI
com a chave em segredo do CI, contra um modelo barato. Se o segredo não estiver disponível (ex.: PR
de fork), o job sai com status **`nao_verificado`**, nunca verde.

## Como adicionar um provedor

1. `npm i <pacote do provedor no AI SDK>` (ex.: `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`).
2. Criar `src/providers/<tipo>/<tipo>.factory.ts`, implementando `ProviderFactory`.
3. Registrar a fábrica no `ProvidersModule`.
4. Acrescentar a regra `<tipo>-confinado` no dependency-cruiser.
5. Testes de contrato da fábrica. Para promover a oficial: smoke test real + exemplo na config.

Nenhum desses passos toca `OpenAiCompatModule` ou `RoutingModule`. Se um provedor exigir isso, a
interface está errada, e o ajuste vem com ADR.

## Testes com mock

Os testes de contrato e de roteamento usam o modelo mock de teste do AI SDK (exportado em `ai/test`
na versão pinada), registrado por uma fábrica `mock`. Essa fábrica só existe quando
`NODE_ENV=test`; em qualquer outro ambiente, uma config com `type: "mock"` é rejeitada no boot.

Mock prova a tradução e o roteamento, **não** o provedor. Só o smoke test real prova o provedor.

## Critérios de aceite

1. Config com `type: "inexistente"` derruba o boot, citando o caminho `providers.<id>.type`.
2. Config com `modelId` que o registry não resolve derruba o boot.
3. `providerOptions` de um modelo chegam ao mock exatamente sob a chave `optionsNamespace`.
4. `grep -r "@openrouter/ai-sdk-provider" src --include=*.ts` só acha arquivos em
   `src/providers/openrouter/`, e o dependency-cruiser falha se um import for adicionado em outro lugar (controle
   negativo: um import de teste fora da pasta deixa o dependency-cruiser vermelho).
5. O smoke test real passa contra o OpenRouter em CI com segredo, e reporta `nao_verificado` sem
   segredo.
6. Uma fábrica `openai-compatible` de exemplo, escrita só para o teste, entra sem nenhum diff fora
   de `src/providers/` e do registro no módulo.

## Notas de implementação

Confirmadas contra `ai@7.0.150` e `@openrouter/ai-sdk-provider@3.1.0` instalados:

- `AiSdkProvider` é derivado de `Parameters<typeof createProviderRegistry>[0][string]`
  (`ProviderV3 | ProviderV4` na v7), em `provider-factory.ts` e em nenhum outro lugar.
- O registry divide o id `<provider>:<modelId>` no **primeiro** `:`, então um `modelId` do
  OpenRouter com `:` (ex.: `...:free`) funciona; já o id do provedor não pode ter `:` (SPEC-002).
- O pacote do OpenRouter lê `providerOptions.openrouter`, e a fábrica o cria com
  `compatibility: "strict"`, como o pacote pede para a API real (`compatible` omite
  `stream_options`, de que o chunk de `usage` da SPEC-006 depende).
- `ProvidersModule.forRoot({ factories })` recebe a lista de fábricas; `providerFactories()` é o
  registro (hoje só o OpenRouter). A mesma lista alimenta `ConfigModule.forRoot({ providerTypes })`.
- A fábrica `mock` mora em `test/support/` e entra por `forRoot`; em produção ninguém a registra, e
  `type: "mock"` é rejeitado no boot (SPEC-002, validação 2). O critério 6 é provado com uma fábrica
  de teste sobre `customProvider`, sem o pacote `@ai-sdk/openai-compatible`.
- `npm run test:smoke` roda completion, stream e um tool call contra o OpenRouter. Sem
  `OPENROUTER_API_KEY` sai com código 3 e a linha `nao_verificado`.
- `anthology.config.example.json` e `.env.example` já trazem o OpenRouter como provedor oficial.

## Fora de escopo (v1)

Provedores oficiais além do OpenRouter; provedores de embedding; descoberta dinâmica de modelos
(listar modelos do OpenRouter em tempo de execução).
