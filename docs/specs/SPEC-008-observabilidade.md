---
id: SPEC-008
titulo: Observabilidade, health e ciclo de vida
status: rascunho
adrs: [ADR-0008, ADR-0009]
requisitos: [RNF-01, RNF-02, RNF-03, RNF-04, RNF-07]
---

# SPEC-008 — Observabilidade, health e ciclo de vida

## Objetivo

Tornar cada requisição rastreável (que Rota, que modelo, quantas tentativas, quantos tokens, quanto
tempo) sem logar conteúdo de conversa. Também define health, readiness e desligamento gracioso.

## Logs

JSON estruturado em stdout (pino, via `nestjs-pino`), nível vindo de `logging.level`.

### Evento por requisição: `request.completed`

| campo | descrição |
|---|---|
| `requestId` | `x-request-id` do cliente, se for um id válido (≤128 chars, `[A-Za-z0-9._-]`); senão, UUID gerado |
| `keyId` | id da chave do gateway |
| `endUser` | campo `user` da requisição, se veio |
| `requestedModel` | valor de `model` recebido (`auto` ou id de Rota) |
| `route` | Rota resolvida |
| `routedBy` | `client` \| `orchestrator` \| `continuation` \| `single_option` \| `default` |
| `orchestration` | só com `auto`: `{ attempts[], latencyMs, outcome, usage, continuationRejected? }`; o `reason` só entra com `includeContent: true` |
| `stream` | boolean |
| `attempts[]` / `skipped[]` | como na [SPEC-003](SPEC-003-roteamento-e-fallback.md#registro) |
| `model`, `provider`, `upstreamModelId` | quem atendeu |
| `status` | HTTP final |
| `outcome` | `ok` \| `error` \| `client_aborted` \| `stream_error` |
| `errorCode` | `code` da SPEC-001, quando houve erro |
| `latencyMs` | total |
| `ttftMs` | tempo até o primeiro conteúdo (só stream) |
| `usage` | `{ input, output, cached, reasoning }`; `usageMissing: true` se o provedor não informou |
| `finishReason`, `finishReasonRaw` | ver SPEC-005 |

### Conteúdo

`logging.includeContent` é `false` por padrão: `messages`, `tools`, respostas, argumentos de tool
e o `reason` do orquestrador (que pode citar o prompt) **nunca** são logados. Com `true` (só para depuração local), vão em evento separado
`request.content`, nível `debug`. O boot avisa com `warn` quando a flag está ligada.

### Redação

O logger tem `redact` configurado para `req.headers.authorization`, `req.headers.cookie` e qualquer
campo `*apiKey*`/`*key*`. Essa é a defesa em profundidade da [SPEC-007](SPEC-007-autenticacao.md).

## Health

| endpoint | 200 quando | 503 quando |
|---|---|---|
| `GET /health` | o processo responde (liveness) | — |
| `GET /ready` | config carregada e servidor aceitando conexões | em desligamento |

`/ready` **não** chama o provedor. Readiness que depende do OpenRouter tiraria todas as réplicas do
balanceador ao mesmo tempo numa instabilidade dele.

## Desligamento gracioso

No `SIGTERM`:

1. `/ready` passa a responder 503.
2. O servidor para de aceitar conexões novas.
3. Requisições e streams em andamento têm até `server.shutdownGraceMs` para terminar.
4. Esgotado o prazo, streams abertos recebem o evento de erro `code: "server_shutting_down"`
   ([SPEC-006](SPEC-006-streaming-sse.md)), e o processo sai.

## Meta de overhead (RNF-01)

O overhead do gateway até o primeiro byte (excluída a latência do upstream) tem meta de **p95 ≤
50 ms**. A medição usa provedor mock com latência zero, 50 conexões concorrentes e payload de 10
mensagens. O resultado (par de números com o comando que os gerou) vai na descrição do PR que
fechar o M2 do PRD. É uma meta a validar, não um número já medido.

## Meta de latência do orquestrador (RNF-07)

A orquestração (`orchestration.latencyMs`) tem meta de **p95 ≤ 1 s** com o modelo orquestrador
real. O timeout (`orchestrator.timeoutMs`, padrão 5 s) é o teto duro. A medição usa 100
requisições `auto` com o recorte padrão, e o resultado vai na descrição do PR que fechar o M5 do
PRD. Também é meta a validar: depende do modelo escolhido como orquestrador.

## Critérios de aceite

1. Toda requisição produz exatamente um `request.completed`, inclusive as que falham com 401, 404
   ou 400 de validação (essas com `route` e `attempts` vazios quando não chegaram ao roteamento).
2. Com `includeContent: false`, um teste que envia a string-sentinela `SENTINELA-123` no prompt não
   a encontra no log capturado. Com a flag `true`, encontra (controle negativo).
3. `x-request-id` válido do cliente é ecoado na resposta e aparece no log. Um inválido é
   substituído por UUID.
4. `SIGTERM` com um stream aberto: `/ready` vira 503 na hora, e o stream termina normalmente se
   acabar dentro do prazo.
5. `/ready` responde 200 com o provedor mock fora do ar.

## Fora de escopo (v1)

Métricas Prometheus, tracing OpenTelemetry (o AI SDK tem telemetria experimental, para avaliar
depois), dashboards, cálculo de custo em moeda.
