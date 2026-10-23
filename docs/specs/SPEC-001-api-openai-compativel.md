---
id: SPEC-001
titulo: API pública compatível com OpenAI
status: rascunho
adrs: [ADR-0001, ADR-0006]
requisitos: [RF-01, RF-03, RNF-05]
specs-relacionadas: [SPEC-009]
---

# SPEC-001 — API pública compatível com OpenAI

## Objetivo

Definir o contrato HTTP público do Anthology: endpoints, parâmetros aceitos, formato de resposta e
de erro. Esse contrato é o subconjunto da API Chat Completions da OpenAI que o gateway promete
honrar ([ADR-0001](../adrs/0001-api-publica-compativel-com-openai.md)).

## Endpoints

| método | caminho | autenticação | descrição |
|---|---|---|---|
| `POST` | `/v1/chat/completions` | sim | gera resposta; `stream: true` muda para SSE ([SPEC-006](SPEC-006-streaming-sse.md)) |
| `GET` | `/v1/models` | sim | lista as **Rotas** visíveis à chave |
| `GET` | `/v1/models/{id}` | sim | uma Rota; 404 se não existe ou não é visível à chave |
| `GET` | `/health`, `/ready` | não | ver [SPEC-008](SPEC-008-observabilidade.md) |

### `GET /v1/models`

O primeiro item é sempre `auto` (o orquestrador, [SPEC-009](SPEC-009-orquestrador.md)). Depois vem
cada Rota permitida para a chave. `created` é o instante do boot, em segundos Unix.

```json
{
  "object": "list",
  "data": [
    { "id": "auto", "object": "model", "created": 1792627200, "owned_by": "anthology" },
    { "id": "code", "object": "model", "created": 1792627200, "owned_by": "anthology" }
  ]
}
```

## `POST /v1/chat/completions` — parâmetros

A validação da entrada usa schema zod. Campo desconhecido é **ignorado** (clientes mandam campos
novos o tempo todo). Campo conhecido com valor que o gateway não honra é **rejeitado** com 400, para
o cliente não receber um comportamento silenciosamente diferente.

| parâmetro | tratamento |
|---|---|
| `model` | **obrigatório**; `"auto"` aciona o orquestrador ([SPEC-009](SPEC-009-orquestrador.md)); qualquer outro valor é o id de uma Rota ([SPEC-003](SPEC-003-roteamento-e-fallback.md)) |
| `messages` | obrigatório, não vazio; papéis e partes em [SPEC-005](SPEC-005-traducao-de-mensagens-e-tool-calling.md) |
| `stream` | `true` → SSE |
| `stream_options.include_usage` | chunk final com `usage` ([SPEC-006](SPEC-006-streaming-sse.md)) |
| `temperature`, `top_p`, `seed`, `presence_penalty`, `frequency_penalty`, `stop` | repassados |
| `max_completion_tokens`, `max_tokens` | repassados como `maxOutputTokens`; se vierem os dois, vale `max_completion_tokens` |
| `tools`, `tool_choice`, `parallel_tool_calls` | [SPEC-005](SPEC-005-traducao-de-mensagens-e-tool-calling.md) |
| `response_format` | `text`, `json_object`, `json_schema` ([SPEC-005](SPEC-005-traducao-de-mensagens-e-tool-calling.md)) |
| `user` | só log (como `end_user`); não é repassado na v1 |
| `n` | aceito só `1`; `>1` → 400 `unsupported_parameter` |
| `logprobs`, `top_logprobs`, `logit_bias` | `400 unsupported_parameter` |
| `functions`, `function_call` (legado) | `400 unsupported_parameter`; use `tools` |
| `audio`, `modalities` com áudio, `prediction` | `400 unsupported_parameter` |

Valor `null` equivale a parâmetro ausente (o SDK `openai` e outros clientes mandam `null`). Valores
neutros são honráveis e passam: `n: 1`, `logprobs: false`, `modalities: ["text"]`. Faixas
validadas: `temperature` 0–2, `top_p` 0–1, `presence_penalty` e `frequency_penalty` −2–2, `seed`
inteiro, `max_tokens`/`max_completion_tokens` inteiro positivo, `stop` com até 4 itens; fora da
faixa → 400 `invalid_request` com `param`. O corpo JSON aceita até um limite configurável, acima
dele a resposta é 413.

A precedência entre parâmetro da requisição e padrão da configuração está na
[SPEC-003](SPEC-003-roteamento-e-fallback.md#merge-de-parâmetros).

## Resposta (sem streaming)

```json
{
  "id": "chatcmpl-3f1c…",
  "object": "chat.completion",
  "created": 1792627260,
  "model": "code",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "…", "tool_calls": [] },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 120, "completion_tokens": 48, "total_tokens": 168 }
}
```

- `id` é gerado pelo gateway (`chatcmpl-` + UUID v4). `created` está em segundos Unix.
- **`model` ecoa o valor pedido** (`auto` ou o id da Rota). A Rota escolhida e o modelo que de
  fato atendeu vão nos headers `x-anthology-route` e `x-anthology-model`. Assim o cliente vê um
  valor estável mesmo quando o orquestrador ou o fallback agem.
- `tool_calls` só aparece quando não está vazio. `content` é `null` quando a resposta só tem
  `tool_calls`.

### Headers de resposta

| header | conteúdo |
|---|---|
| `x-request-id` | id da requisição (ecoado do cliente ou gerado) |
| `x-anthology-route` | Rota resolvida |
| `x-anthology-routed-by` | quem escolheu a Rota: `client`, `orchestrator`, `continuation`, `single_option` ou `default` ([SPEC-009](SPEC-009-orquestrador.md)) |
| `x-anthology-model` | Modelo que atendeu, como `<id do modelo na config>` |
| `x-anthology-attempts` | nº de candidatos tentados (1 = sem fallback) |

### Header de requisição

| header | efeito |
|---|---|
| `x-anthology-route` | opcional, só com `model: "auto"`. Quando a última mensagem é `tool`, o gateway reaproveita esta Rota sem chamar o orquestrador ([SPEC-009](SPEC-009-orquestrador.md), continuação). O cliente devolve o valor recebido na resposta anterior. |

## Erros

O corpo segue o formato da OpenAI, que o SDK oficial `openai` já entende:

```json
{ "error": { "message": "…", "type": "invalid_request_error", "param": "model", "code": "model_not_found" } }
```

| situação | HTTP | `type` | `code` |
|---|---|---|---|
| JSON inválido / schema violado | 400 | `invalid_request_error` | `invalid_request` |
| parâmetro não honrado | 400 | `invalid_request_error` | `unsupported_parameter` |
| nenhum candidato da Rota tem a Capacidade exigida | 400 | `invalid_request_error` | `unsupported_capability` |
| sem `Authorization` ou chave inválida | 401 | `authentication_error` | `invalid_api_key` |
| Rota inexistente **ou** não visível à chave | 404 | `invalid_request_error` | `model_not_found` |
| corpo acima do limite | 413 | `invalid_request_error` | `request_too_large` |
| todos os candidatos falharam com 429 | 429 | `rate_limit_error` | `upstream_rate_limited` |
| todos os candidatos falharam (outros retentáveis) | 502 | `api_error` | `upstream_unavailable` |
| timeout em todos os candidatos | 504 | `api_error` | `upstream_timeout` |
| erro não retentável do upstream (ex.: 400 de conteúdo) | status do upstream | `invalid_request_error` | `upstream_rejected` |
| erro interno | 500 | `api_error` | `internal_error` |

Rota não visível à chave devolve 404, não 403, para não revelar que ela existe.

A mensagem de erro **nunca** inclui a chave do provedor, o corpo enviado ao upstream ou stack trace.

## Critérios de aceite

1. Um script com o SDK oficial `openai` (Node) que só troca `baseURL` e `apiKey` consegue: listar
   modelos; completar sem stream; completar com stream; fazer um ciclo completo de tool call (pedido
   → `tool_calls` → mensagem `tool` → resposta final). O teste roda contra o gateway com provedor
   mock e passa no CI.
2. O mesmo cenário roda com o SDK `openai` de Python (teste de contrato separado).
3. Para cada linha da tabela de erros existe um teste que provoca a situação e confere status,
   `type` e `code`.
4. `n: 2` devolve 400 `unsupported_parameter` com `param: "n"`. Um campo desconhecido
   (`foo: 1`) não muda a resposta.
5. `x-anthology-model` traz o modelo do fallback quando o primário falhou, e o `model` do corpo
   continua sendo o id da Rota.
6. O cenário do critério 1 roda também com `model: "auto"`, usando os headers de continuação
   no ciclo de tool call. `/v1/models` lista `auto` em primeiro lugar.

## Fora de escopo (v1)

`/v1/embeddings`, `/v1/completions`, `/v1/responses`, áudio, geração de imagem, `logprobs`, `n > 1`.
