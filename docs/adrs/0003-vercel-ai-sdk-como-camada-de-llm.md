---
status: aceito
data: 2026-10-22
---

# ADR-0003 — Vercel AI SDK como camada única de acesso a LLMs

**Contexto.** O gateway começa com um provedor (OpenRouter, [ADR-0004](0004-openrouter-como-provedor-oficial-inicial.md)),
mas precisa aceitar outros sem reescrever roteamento nem API. Cada provedor tem formato próprio de
mensagens, tool calling, streaming e erros.

**Decisão.** Toda chamada a LLM passa pelo **AI SDK Core** (pacote `ai`):

- `generateText` / `streamText` para gerar.
- `createProviderRegistry` para resolver modelos por `"<provedor>:<modelo>"`.
- `tool()` + `jsonSchema()` **sem `execute`** para tool calling transparente
  ([ADR-0007](0007-tool-calling-transparente.md)).

O uso do pacote fica confinado a `ProvidersModule`, `RoutingModule` e à camada de tradução
([SPEC-005](../specs/SPEC-005-traducao-de-mensagens-e-tool-calling.md)). A versão é **pinada
exata**, sem `^`.

**Alternativas consideradas.**

- *Proxy HTTP direto para o OpenRouter.* O OpenRouter já é OpenAI-compatível, então um proxy quase
  pass-through seria **mais simples** para a v1. Rejeitado porque amarra o gateway ao formato
  OpenAI upstream: provedores com API nativa diferente (Anthropic, Google, Bedrock) exigiriam
  reescrever a tradução depois. É a troca consciente de simplicidade agora por extensibilidade.
- *LangChain.js:* traz abstrações de agente e chain que o gateway não usa.
- *SDK nativo de cada provedor:* um adaptador escrito à mão por provedor; o AI SDK já mantém esses
  adaptadores.

**Consequências.**

- **Dupla tradução** (OpenAI → `ModelMessage` → provedor). Campo que o AI SDK não modela se perde,
  a menos que passe por `providerOptions`. A tabela do que se preserva está na SPEC-005.
- O AI SDK quebra contrato entre majors (a v5 renomeou `parameters` → `inputSchema` e
  `maxTokens` → `maxOutputTokens`, e trocou os tipos de parte do stream). Por isso a versão é
  pinada, o upgrade é tarefa explícita e os testes de contrato da SPEC-001 são a rede de proteção.
- Os nomes de API citados nas specs seguem a doc em ai-sdk.dev consultada em 2026-10-22. Eles são
  reconferidos contra a versão pinada no início da implementação.
