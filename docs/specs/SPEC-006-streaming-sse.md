---
id: SPEC-006
titulo: Streaming SSE
status: rascunho
adrs: [ADR-0001, ADR-0002, ADR-0008]
requisitos: [RF-02]
---

# SPEC-006 — Streaming SSE

## Objetivo

Definir como o stream do AI SDK (`streamText`) vira o stream SSE de `chat.completion.chunk` que os
clientes OpenAI esperam, incluindo tool calls incrementais, `usage`, erros e desconexão.

## Transporte

- Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`,
  `Connection: keep-alive`, `X-Accel-Buffering: no` (desliga o buffer de proxy nginx), mais os
  headers `x-anthology-*` da [SPEC-001](SPEC-001-api-openai-compativel.md).
- Cada evento é `data: <json>\n\n`. O fim normal é `data: [DONE]\n\n`.
- A escrita é direta no response (não usa `@Sse()`, ver [ADR-0002](../adrs/0002-backend-em-nestjs.md)).
  Respeita backpressure: quando `write()` devolve `false`, espera `drain`.

## Ponto de commit

Com `model: "auto"`, a orquestração ([SPEC-009](SPEC-009-orquestrador.md)) termina inteira antes
de o stream da Rota começar. A latência dela entra no tempo até o primeiro byte.

Os headers HTTP (status 200) **só saem quando chega a primeira parte do stream upstream**, de
qualquer tipo. Até lá, falha do candidato pode ir ao fallback
([SPEC-003](SPEC-003-roteamento-e-fallback.md#ponto-de-commit-streaming)), e falha da cadeia toda
volta como erro HTTP normal, em JSON (não SSE).

Depois do commit, enquanto não houver conteúdo a enviar (ex.: modelo raciocinando, com o reasoning
descartado na v1), o gateway manda um comentário SSE `: keep-alive\n\n` a cada 15 s, para proxies
com timeout de ociosidade não derrubarem a conexão.

## Formato do chunk

```json
{
  "id": "chatcmpl-3f1c…",
  "object": "chat.completion.chunk",
  "created": 1792627260,
  "model": "code",
  "choices": [{ "index": 0, "delta": { "content": "Olá" }, "finish_reason": null }]
}
```

`id`, `created` e `model` são os mesmos em todos os chunks da resposta. `model` é o id da Rota,
como na SPEC-001.

## Mapeamento de partes

| parte do AI SDK | chunk emitido |
|---|---|
| primeira parte de conteúdo (texto ou tool) | antes dela, um chunk com `delta: { role: "assistant", content: "" }` |
| `text-delta` | `delta: { content: <texto> }` |
| `tool-input-start` (id, toolName) | `delta: { tool_calls: [{ index: i, id, type: "function", function: { name, arguments: "" } }] }` |
| `tool-input-delta` (id, delta) | `delta: { tool_calls: [{ index: i, function: { arguments: <delta> } }] }` |
| `tool-call` cujo input **não** foi transmitido em partes | um chunk com o tool call inteiro (`id`, `name`, `arguments` completo) |
| `tool-input-end`, `start`, `start-step`, `finish-step`, `text-start`, `text-end` | nada |
| `reasoning-*` | nada na v1 |
| `finish` | `delta: {}`, `finish_reason` mapeado (tabela da [SPEC-005](SPEC-005-traducao-de-mensagens-e-tool-calling.md)) |
| `error` | evento de erro (abaixo) |

- `index` do tool call: ordem de aparição do `id` em `tool-input-start` ou `tool-call`, a partir
  de 0, estável durante o stream.
- Os nomes das partes seguem a doc do AI SDK consultada em 2026-10-22 e são reconferidos na versão
  pinada.

### `usage`

Com `stream_options.include_usage: true`, depois do chunk de `finish_reason` e antes do `[DONE]`,
sai um chunk com `choices: []` e `usage` no formato da SPEC-005. Sem a opção, `usage` não sai no
stream; vai só para o log.

## Erro depois do commit

```text
data: {"error":{"message":"upstream interrompeu a geração","type":"api_error","code":"upstream_stream_error"}}

```

O stream é encerrado **sem** `[DONE]`, para o cliente distinguir fim normal de interrupção. O SDK
`openai` levanta exceção ao receber um evento com `error`; o teste de contrato confirma isso.

## Desconexão do cliente

`close` no request dispara `AbortController.abort()`, cujo sinal foi passado ao `streamText`
(`abortSignal`). A chamada upstream é cancelada, nenhum fallback é tentado e o log registra
`outcome: "client_aborted"` com os tokens até ali, se o provedor os informar.

## Critérios de aceite

Com mock de stream roteirizado:

1. Stream só de texto: sequência exata `role` → N × `content` → `finish_reason: "stop"` →
   `[DONE]`. O texto concatenado é igual ao do mock.
2. Stream com 2 tool calls intercalados: o cliente `openai` (Node), acumulando os deltas pelo
   `index`, reconstrói os dois `tool_calls` com `arguments` em JSON válido e igual ao do mock.
3. Mock que manda `tool-call` sem `tool-input-*` → um chunk único com o tool call completo.
4. `include_usage: true` → o penúltimo evento tem `choices: []` e `usage`. Sem a opção, nenhum
   chunk tem `usage`.
5. Erro depois de 3 deltas → o cliente recebe os 3, depois o evento de erro, e nunca o `[DONE]`.
6. O cliente aborta depois do 2º delta → o mock observa o `abortSignal` disparado (asserção no
   mock), e o log tem `client_aborted`.
7. Mock que demora 40 s entre a primeira parte e o primeiro texto → o cliente recebe pelo menos
   2 `: keep-alive` (teste com relógio falso).
8. Falha do candidato antes da primeira parte → a resposta é o stream do fallback, sem nenhum byte
   do candidato que falhou.
