---
id: SPEC-007
titulo: Autenticação por chave do gateway
status: rascunho
adrs: [ADR-0005, ADR-0009]
requisitos: [RF-12, RNF-03]
---

# SPEC-007 — Autenticação por chave do gateway

## Objetivo

Garantir que só consumidores autorizados usem o gateway, e só nas Rotas liberadas para eles. As
chaves dos **provedores** nunca saem do servidor.

## Comportamento

1. Todo endpoint `/v1/*` exige `Authorization: Bearer <chave>`. `/health` e `/ready` não exigem.
2. As chaves válidas vêm de `auth.keys[]` ([SPEC-002](SPEC-002-arquivo-de-configuracao.md)). O
   valor de cada uma é lido da variável `keyEnv` no boot e guardado só como **SHA-256** em memória.
3. A verificação calcula o SHA-256 da chave recebida e compara com cada digest usando
   `crypto.timingSafeEqual` (tempo constante, sem curto-circuito por prefixo).
4. Chave ausente, malformada ou desconhecida → 401 `invalid_api_key` (formato da SPEC-001).
   A mensagem é a mesma nos três casos.
5. Com a chave aceita, o guard anexa `keyId` ao contexto da requisição. A permissão de Rota é
   checada na resolução ([SPEC-003](SPEC-003-roteamento-e-fallback.md), passo 1). `/v1/models` só
   lista as Rotas permitidas.
6. O header `api-key` (estilo Azure) **não** é aceito na v1.

## Regras de segredo

- O log registra `keyId`, nunca a chave nem prefixo dela ([SPEC-008](SPEC-008-observabilidade.md)).
- O header `Authorization` do cliente **nunca** é repassado ao provedor. O gateway usa só a chave
  do provedor vinda de `apiKeyEnv`.
- Nenhuma resposta, erro ou header expõe chave de provedor ou de gateway.
- Rotacionar uma chave = trocar o valor da variável de ambiente e reiniciar.

## Critérios de aceite

1. Sem header → 401. `Bearer` vazio → 401. Chave errada → 401. Os três corpos são idênticos.
2. Chave válida → 200 em `/v1/models`, com só as Rotas de `routes` da chave.
3. `/health` sem chave → 200.
4. Teste com spy no provedor mock: o header `Authorization` recebido pelo mock é o da chave do
   provedor, nunca o do cliente.
5. Teste de log: depois de uma requisição autenticada, o log capturado não contém o valor da chave
   (busca pela string exata, com controle negativo: o mesmo teste falha se o valor for logado de
   propósito).

## Fora de escopo (v1)

Rate limit por chave, orçamento por chave, chaves criadas por API, OAuth/JWT, mTLS (ver
[ADR-0009](../adrs/0009-gateway-stateless-sem-banco-na-v1.md)).
