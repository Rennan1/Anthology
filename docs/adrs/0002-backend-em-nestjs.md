---
status: aceito
data: 2026-10-22
---

# ADR-0002 — Backend em NestJS

**Contexto.** O gateway precisa de módulos bem separados: API, roteamento, provedores, configuração
e autenticação. Também precisa de injeção de dependência, para trocar provedor real por mock nos
testes sem mexer no código de produção.

**Decisão.** O backend é feito em **NestJS** (major vigente no início da implementação, pinada no
`package.json`), em TypeScript com `strict: true`, sobre o adapter HTTP padrão (Express). A divisão
em módulos é esta:

| módulo | responsabilidade | spec |
|---|---|---|
| `ConfigModule` | carregar e validar o JSON de configuração no boot | [SPEC-002](../specs/SPEC-002-arquivo-de-configuracao.md) |
| `AuthModule` | guard de chave do gateway | [SPEC-007](../specs/SPEC-007-autenticacao.md) |
| `OpenAiCompatModule` | controllers `/v1/*`, validação de entrada, tradução de formato | [SPEC-001](../specs/SPEC-001-api-openai-compativel.md), [SPEC-005](../specs/SPEC-005-traducao-de-mensagens-e-tool-calling.md), [SPEC-006](../specs/SPEC-006-streaming-sse.md) |
| `RoutingModule` | escolher a Rota (explícita ou pelo orquestrador), resolver a cadeia de candidatos, fallback | [SPEC-003](../specs/SPEC-003-roteamento-e-fallback.md), [SPEC-009](../specs/SPEC-009-orquestrador.md) |
| `ProvidersModule` | fábricas de provedor e registry do AI SDK | [SPEC-004](../specs/SPEC-004-camada-de-provedores.md) |
| `HealthModule` / logging | health, readiness, logs estruturados | [SPEC-008](../specs/SPEC-008-observabilidade.md) |

**Alternativas consideradas.** Fastify puro ou Hono são mais leves, mas o time escolheu NestJS pela
estrutura de módulos e pela DI. O adapter Fastify do Nest fica como otimização possível, sem
mudança de arquitetura.

**Consequências.**

- O streaming escreve direto no objeto de resposta em vez de usar o `@Sse()` do Nest. Assim
  controlamos o status HTTP antes do primeiro byte e o terminador `[DONE]`
  ([SPEC-006](../specs/SPEC-006-streaming-sse.md)).
- A dependência entre módulos é de mão única: `OpenAiCompat → Routing → Providers`. Nenhum módulo
  abaixo conhece o formato OpenAI.
