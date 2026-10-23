---
id: SPEC-003
titulo: Roteamento e fallback
status: rascunho
adrs: [ADR-0006, ADR-0008]
requisitos: [RF-04, RF-05]
---

# SPEC-003 — Roteamento e fallback

## Objetivo

Definir como uma requisição vira uma chamada ao modelo upstream mais apto: resolução da Rota
(explícita ou escolhida pelo orquestrador, [SPEC-009](SPEC-009-orquestrador.md)), filtro por
Capacidade, merge de parâmetros e fallback
([ADR-0006](../adrs/0006-roteamento-por-orquestrador.md),
[ADR-0008](../adrs/0008-fallback-no-gateway.md)).

O `RoutingModule` não conhece o formato OpenAI. Ele recebe uma `GatewayRequest` já traduzida
([SPEC-005](SPEC-005-traducao-de-mensagens-e-tool-calling.md)) e devolve resultado ou stream do AI
SDK.

## Algoritmo

```text
1. rota      ← req.model = "auto"  → SPEC-009 (orquestrador, continuação ou defaultRoute)
               senão              → config.routes[req.model]
                                    ausente, ou não permitida para a chave → 404 model_not_found
2. cadeia    ← [rota.target, ...rota.fallbacks]
3. exigidas  ← capacidadesExigidas(req)
4. cadeia    ← cadeia.filter(m ⊇ exigidas)
               vazia                                        → 400 unsupported_capability
5. para cada candidato da cadeia:
     params  ← merge(candidato, rota, req)
     tenta   ← chamar(candidato, params)   (timeout e maxRetries do candidato)
     sucesso → devolve (e registra a tentativa)
     erro    → registra; retentável e antes do commit? próximo : propaga
6. cadeia esgotada → erro agregado (tabela de erros da SPEC-001)
```

### Capacidades exigidas

| a requisição tem… | exige |
|---|---|
| `tools` não vazio | `tools` |
| alguma parte `image_url` em qualquer mensagem | `vision` |
| `response_format.type = "json_schema"` | `json_schema` |

Um candidato sem a Capacidade **sai da cadeia antes** de qualquer chamada. Ele não conta como
tentativa, mas aparece no log como `skipped: missing_capability`.

`json_object` não exige Capacidade: é pedido por instrução e o AI SDK cuida dele (ver SPEC-005).

### Merge de parâmetros

Precedência da menor para a maior:

```text
models.<id>.defaults  <  routes.<id>.defaults  <  requisição  <  routes.<id>.enforce
```

Depois do merge, `maxOutputTokens` é limitado a `models.<id>.maxOutputTokens` quando este existe.
O merge é refeito **para cada candidato**, porque o fallback pode ter defaults e teto diferentes.

## Fallback

### Classificação de erro

| erro do upstream / da tentativa | retentável (vai ao próximo)? |
|---|---|
| HTTP 408, 429, 500, 502, 503, 504 | sim |
| erro de rede (conexão recusada, reset, DNS) | sim |
| timeout do candidato (`timeoutMs`) | sim |
| HTTP 400, 401, 403, 404, 413, 422 | **não**: o mesmo pedido falharia igual, ou é erro de configuração |
| abort pelo cliente | **não**: encerra tudo |

O status vem de `APICallError.statusCode` do AI SDK. Erro sem status, e que não seja de rede nem
timeout, é tratado como **não retentável**.

401/403 do upstream indicam chave do provedor errada (erro de configuração). Saem no log com nível
`error` e voltam ao cliente como 502 `upstream_unavailable`, sem detalhe.

### Retries dentro do mesmo candidato

O `maxRetries` do candidato (padrão 1) vai para o AI SDK, que já faz backoff. O fallback só começa
depois que os retries do candidato se esgotam.

### Ponto de commit (streaming)

Em streaming, a tentativa só é **commitada** quando chega a primeira parte do stream upstream de
qualquer tipo. Nesse momento os headers HTTP saem para o cliente (ver [SPEC-006](SPEC-006-streaming-sse.md)).

- Erro **antes** do commit: segue a classificação acima e pode ir ao próximo candidato.
- Erro **depois** do commit: vira evento de erro no stream. Não há fallback.

Sem streaming, toda falha acontece antes do commit.

### Timeout global

O tempo total da requisição é a soma dos timeouts da cadeia. Não existe teto global separado na v1.
O cliente que quiser teto usa o próprio timeout HTTP, e o abort dele se propaga.

## Registro

Cada requisição produz **um** evento de log `routing.completed` ([SPEC-008](SPEC-008-observabilidade.md))
com a lista de tentativas:

```json
{
  "route": "code",
  "routedBy": "orchestrator",
  "attempts": [
    { "model": "sonnet", "outcome": "error", "status": 429, "latencyMs": 812 },
    { "model": "mini",   "outcome": "ok",    "latencyMs": 2140 }
  ],
  "skipped": [{ "model": "flash", "reason": "missing_capability", "missing": ["json_schema"] }]
}
```

## Critérios de aceite

Com provedor mock que responde por roteiro:

1. Rota com `target` ok → 1 tentativa, `x-anthology-attempts: 1`.
2. `target` responde 429 e o fallback responde ok → 200; `x-anthology-model` = fallback; log com 2
   tentativas.
3. `target` responde 400 → 400 `upstream_rejected` e o fallback **não** é chamado (o mock conta
   zero chamadas).
4. Requisição com `tools` numa Rota cujo `target` não tem `tools` → o `target` é pulado sem chamada
   e o fallback com `tools` atende.
5. Nenhum candidato com `vision` e requisição com imagem → 400 `unsupported_capability`, zero
   chamadas ao mock.
6. Streaming: o `target` falha (503) antes da primeira parte → o fallback atende e o cliente recebe
   um stream íntegro, só do fallback.
7. Streaming: o `target` falha depois da primeira parte → o cliente recebe o evento de erro, e o
   fallback **não** é chamado.
8. Merge: `routes.general.enforce.maxOutputTokens = 4000` e requisição com `max_tokens: 10000` → o
   mock recebe `maxOutputTokens: 4000`.
9. Merge: `models.sonnet.defaults.temperature = 0.2` e requisição com `temperature: 0.9` → o mock
   recebe 0.9.
10. Chave com `routes: ["general"]` pedindo `code` → 404 `model_not_found`.
11. `model: "auto"` com o orquestrador escolhendo `code`, e o `target` de `code` respondendo 429
    → o fallback de `code` atende. A escolha da Rota e o fallback dentro dela são independentes.

## Fora de escopo (v1)

Balanceamento por peso entre modelos; circuit breaker com estado
(exige memória compartilhada entre réplicas, ver ADR-0009); roteamento por custo ou latência medidos.
