---
id: SPEC-005
titulo: Tradução de mensagens e tool calling
status: rascunho
adrs: [ADR-0003, ADR-0007]
requisitos: [RF-06, RF-07, RF-08]
---

# SPEC-005 — Tradução de mensagens e tool calling

## Objetivo

Definir a tradução nos dois sentidos entre o formato Chat Completions da OpenAI e as estruturas do
AI SDK (`ModelMessage`, `tool`, resultado de `generateText`). Inclui o tool calling transparente
([ADR-0007](../adrs/0007-tool-calling-transparente.md)).

A tradução fica em `src/openai-compat/translate/` e é feita de **funções puras**, sem I/O. É a parte
com mais testes unitários do projeto.

## Entrada: `messages` → `ModelMessage[]`

| OpenAI | AI SDK |
|---|---|
| `system` ou `developer`, `content` string | `{ role: "system", content }` |
| `system`/`developer` com array de partes `text` | as partes concatenadas com `\n\n` |
| `user`, `content` string | `{ role: "user", content }` |
| `user`, parte `{ type: "text", text }` | parte `{ type: "text", text }` |
| `user`, parte `{ type: "image_url", image_url: { url } }` | parte `{ type: "image", image: URL }`; `data:` URL vira bytes + `mediaType` |
| `user`, parte `input_audio` ou `file` | **400 `unsupported_parameter`** na v1 |
| `assistant`, `content` | parte `text` |
| `assistant`, `tool_calls[i]` | parte `{ type: "tool-call", toolCallId: id, toolName: function.name, input: JSON.parse(function.arguments) }` |
| `tool`, `{ tool_call_id, content }` | `{ role: "tool", content: [{ type: "tool-result", toolCallId, toolName, output }] }` |
| campo `name` em qualquer mensagem | ignorado |

Regras:

- `function.arguments` que não é JSON válido → 400 `invalid_request`, com `param` apontando o
  índice da mensagem.
- **`toolName` do resultado:** o formato OpenAI não traz o nome da tool na mensagem `tool`. O
  tradutor o recupera do `tool_calls` da mensagem `assistant` anterior que tem o mesmo id. Sem
  correspondência → 400 `invalid_request` (`tool_call_id sem tool_call correspondente`).
- `output` do resultado: `content` string → `{ type: "text", value }`. Array de partes `text`
  → as partes concatenadas.
- Mensagens `system` no meio da conversa ficam na posição original (o AI SDK aceita).

## Entrada: `tools`, `tool_choice`, `parallel_tool_calls`

```ts
tools = Object.fromEntries(req.tools.map(t => [
  t.function.name,
  tool({ description: t.function.description, inputSchema: jsonSchema(t.function.parameters ?? { type: "object", properties: {} }) }),
  // sem execute: o gateway não executa tools (ADR-0007)
]));
```

- Só `type: "function"` é aceito. Outros tipos → 400 `unsupported_parameter`.
- Nomes de tool duplicados → 400 `invalid_request`.
- `strict: true` em `function` é repassado ao provedor, quando ele aceita, via `providerOptions`.
  Senão, é ignorado.

| `tool_choice` OpenAI | AI SDK |
|---|---|
| `"auto"` (ou ausente) | `"auto"` |
| `"none"` | `"none"` |
| `"required"` | `"required"` |
| `{ type: "function", function: { name } }` | `{ type: "tool", toolName: name }` |

`parallel_tool_calls` vai para `providerOptions[namespace]` quando a fábrica declara suporte (o
OpenRouter aceita `parallel_tool_calls` no corpo). Caso contrário, é ignorado, e o log registra
`ignored_params: ["parallel_tool_calls"]`.

**Um passo só:** a chamada usa a condição de parada de passo único (o padrão do AI SDK). Com tools
sem `execute`, a geração termina no `tool-call`, com `finishReason: "tool-calls"`.

## Entrada: `response_format`

| `response_format` | tratamento |
|---|---|
| `{ type: "text" }` ou ausente | geração de texto normal |
| `{ type: "json_object" }` | saída estruturada em modo JSON livre do AI SDK |
| `{ type: "json_schema", json_schema: { name, schema, strict } }` | saída estruturada do AI SDK com `jsonSchema(schema)`; exige a Capacidade `json_schema` ([SPEC-003](SPEC-003-roteamento-e-fallback.md)) |

A resposta devolve o JSON gerado como **string** em `message.content`, como a OpenAI faz. O
gateway não valida o JSON contra o schema na v1: a garantia é do provedor (`strict`). A API exata
de saída estruturada é confirmada contra a versão pinada do AI SDK antes da implementação (questão
aberta Q-07 do PRD).

## Saída: resultado → `chat.completion`

| AI SDK | OpenAI |
|---|---|
| texto | `message.content` (`null` se vazio e houver `tool_calls`) |
| `toolCalls[i]` | `message.tool_calls[i] = { id: toolCallId, type: "function", function: { name: toolName, arguments: JSON.stringify(input) } }` |
| reasoning | **descartado** na v1 (questão aberta Q-01 do PRD) |
| `usage.inputTokens` | `usage.prompt_tokens` |
| `usage.outputTokens` | `usage.completion_tokens` |
| `usage.totalTokens` (ou soma) | `usage.total_tokens` |
| tokens em cache, quando informados | `usage.prompt_tokens_details.cached_tokens` |
| tokens de reasoning, quando informados | `usage.completion_tokens_details.reasoning_tokens` |

| `finishReason` (AI SDK) | `finish_reason` (OpenAI) |
|---|---|
| `stop` | `stop` |
| `length` | `length` |
| `tool-calls` | `tool_calls` |
| `content-filter` | `content_filter` |
| `error`, `other`, `unknown` | `stop`, com o valor original em log (`finish_reason_raw`) |

Uso ausente no provedor → campos `0` e flag `usage_missing: true` no log, nunca omissão silenciosa.

## Critérios de aceite

Testes unitários puros (sem rede) para cada linha das tabelas. Em destaque:

1. Conversa de 4 turnos com 2 tool calls paralelos e 2 mensagens `tool` → `ModelMessage[]` com os
   `toolName` certos, e ida-e-volta (`OpenAI → AI SDK → OpenAI` da saída) preserva `id`, `name` e
   `arguments`.
2. `tool` com `tool_call_id` sem correspondência → 400.
3. `arguments: "{nao-json"` → 400 com `param: "messages[2].tool_calls[0].function.arguments"`.
4. Imagem em `data:image/png;base64,…` vira bytes com `mediaType: "image/png"`. Imagem em `https://`
   vira `URL`.
5. Cada `finishReason` mapeia conforme a tabela, incluindo o fallback `other → stop` com log.
6. Teste de contrato (SPEC-001, critério 1) com o SDK `openai` cobre o ciclo de tool call ponta a
   ponta.

## Fora de escopo (v1)

Execução de tools no gateway, MCP, áudio, arquivos (`file`), exposição de reasoning, validação do
JSON gerado contra o schema.
