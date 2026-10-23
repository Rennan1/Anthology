---
status: aceito
data: 2026-10-22
---

# ADR-0001 — Contrato público compatível com a API da OpenAI

**Contexto.** Os consumidores do gateway já falam com LLMs usando o SDK oficial `openai` (Node/Python),
LangChain, LlamaIndex, Vercel AI SDK com `@ai-sdk/openai-compatible` e ferramentas como Continue e
Open WebUI. Todos sabem falar o formato Chat Completions da OpenAI, trocando só a `baseURL`.

**Decisão.** O Anthology expõe um **subconjunto** da API da OpenAI: `POST /v1/chat/completions`
(com e sem streaming) e `GET /v1/models`. O campo `model` da requisição carrega `auto` (o orquestrador
escolhe a Rota) ou o **id de uma Rota** (ver [ADR-0006](0006-roteamento-por-orquestrador.md)),
nunca o id de um modelo upstream. O que fica
dentro e fora do subconjunto está em [SPEC-001](../specs/SPEC-001-api-openai-compativel.md).

**Alternativas consideradas.**

- *API própria:* obrigaria cada consumidor a usar um SDK nosso. Rejeitada.
- *OpenAI Responses API (`/v1/responses`):* tem menos clientes compatíveis e é stateful por desenho
  (`previous_response_id`), o que conflita com [ADR-0009](0009-gateway-stateless-sem-banco-na-v1.md).
  Fica como candidata para uma versão futura.
- *Anthropic Messages API:* tem menos clientes genéricos que a Chat Completions.

**Consequências.**

- Herdamos as idiossincrasias do formato da OpenAI: `tool_calls` com `arguments` em string JSON,
  `finish_reason`, `[DONE]` no fim do stream.
- Compatibilidade é medida por teste de contrato com o SDK oficial `openai`, não por leitura da doc.
- Os endpoints `/v1/embeddings`, `/v1/completions` (legado), áudio e imagem ficam fora da v1.
