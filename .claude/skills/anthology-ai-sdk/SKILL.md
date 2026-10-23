---
name: anthology-ai-sdk
description: Use antes de escrever, alterar ou depurar qualquer código do Anthology que chame o Vercel AI SDK (`ai`, `@ai-sdk/*`) ou o `@openrouter/ai-sdk-provider` — generateText, streamText, tool(), jsonSchema(), createProviderRegistry, partes do stream, providerOptions, saída estruturada, APICallError, usage, modelo mock de teste — e ao fazer upgrade desses pacotes. O AI SDK renomeia API entre majors; esta skill faz conferir a API da versão PINADA no projeto em vez de escrever de memória. Use mesmo quando a chamada parecer óbvia.
---

# AI SDK na versão pinada

O Anthology passa toda chamada de LLM pelo AI SDK ([ADR-0003](../../../docs/adrs/0003-vercel-ai-sdk-como-camada-de-llm.md)).
**O AI SDK quebra contrato entre majors.** A v5 renomeou `parameters` → `inputSchema` e
`maxTokens` → `maxOutputTokens`, e trocou os tipos de parte do stream. Versões seguintes mudaram
outros nomes. O que você lembra do AI SDK é uma mistura de várias majors, e código escrito de
memória compila contra a versão errada ou nem compila.

## Procedimento

1. **Leia a versão instalada.** No `package.json`, veja `ai`, `@ai-sdk/provider` e
   `@openrouter/ai-sdk-provider`. Elas são pinadas exatas, sem `^` nem `~`. Se encontrar faixa,
   pare e avise: isso viola o ADR-0003.
2. **Consulte a doc daquela versão:**
   - context7: resolva `AI SDK` e prefira o id versionado que bater com a major instalada (ex.:
     `/websites/ai-sdk_dev_v5`). Use `/websites/ai-sdk_dev` só se a instalada for a atual.
     Para o provedor: `/openrouterteam/ai-sdk-provider`.
   - Se a doc for ambígua, **o tipo instalado é o chão**: leia o `.d.ts` em `node_modules/ai/dist/`
     (busque o símbolo com Grep). Doc descreve a última versão; o `.d.ts` descreve a sua.
3. **Escreva o código** e rode `tsc --noEmit`. Erro de tipo num nome de API do SDK quase sempre
   significa nome de outra major: volte ao passo 2, sem forçar com `as any`.
4. **Registre no corpo do commit** qual fonte confirmou o nome (doc versionada ou `.d.ts`), quando
   a mudança usar API do SDK pela primeira vez no projeto.

## Pontos que mudam entre versões

Confira cada um destes na versão instalada antes de usar:

| conceito | onde o Anthology usa | o que confirmar |
|---|---|---|
| definição de tool sem `execute` | tradução de `tools` (SPEC-005) | nome do campo do schema (`inputSchema`?); assinatura de `tool()` e `jsonSchema()` |
| teto de tokens | merge de parâmetros (SPEC-003) | `maxOutputTokens`? |
| tipos de parte do stream | SSE (SPEC-006) | `text-delta`, `tool-input-start`, `tool-input-delta`, `tool-input-end`, `tool-call`, `finish`, `error`, e o nome do campo de texto em cada uma |
| como iterar o stream | SSE (SPEC-006) | `fullStream`, `stream` ou outro; quais promises o resultado expõe |
| parada após 1 passo | tool calling (ADR-0007) | o padrão ainda é passo único? como se expressa (`stopWhen`)? |
| saída estruturada | `response_format` (SPEC-005) e orquestrador (SPEC-009) | API atual (questão Q-07 do PRD) |
| cancelamento | abort do cliente (SPEC-006) | `abortSignal` |
| retries | `maxRetries` do modelo (SPEC-002) | nome e padrão |
| erro HTTP do upstream | fallback (SPEC-003) | `APICallError` e `statusCode`; como reconhecer timeout e erro de rede |
| uso de tokens | `usage` (SPEC-005) | nomes dos campos (input, output, cache, reasoning) |
| registry | ProvidersModule (SPEC-004) | `createProviderRegistry`, separador, tipo de provider aceito (`ProviderV?`) |
| modelo mock | testes (skill `anthology-testes`) | nome exportado em `ai/test` (`MockLanguageModelV?`) e como roteirizar o stream |

Quando um nome confirmado divergir do que as specs citam, atualize a spec no mesmo PR (skill
`anthology-docs`). As specs avisam que os nomes foram tirados da doc de 2026-10-22.

## Fronteira de import

- `ai` só aparece em `src/providers/`, `src/routing/` e `src/openai-compat/translate/`.
- `@openrouter/ai-sdk-provider` só aparece em `src/providers/openrouter/`
  ([ADR-0004](../../../docs/adrs/0004-openrouter-como-provedor-oficial-inicial.md)).

As duas regras são garantidas pelo dependency-cruiser (`ai-sdk-confinado` e
`openrouter-confinado`; skill `anthology-portao-qualidade`).

Se você precisar de `ai` fora desses lugares, a peça está no módulo errado.

## Upgrade de versão

1. Faça numa branch própria, só com o upgrade (`chore(deps): …`, ou `refactor` se exigir código).
2. Leia o migration guide da major nova (context7 ou ai-sdk.dev) **inteiro** antes de mudar código.
3. Suba a versão exata e rode `tsc`, a suíte inteira, a de contrato e o smoke real
   (skill `anthology-testes`).
4. Atualize os nomes citados nas specs, principalmente SPEC-005 e SPEC-006.
