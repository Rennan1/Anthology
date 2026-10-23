---
status: aceito
data: 2026-10-22
---

# ADR-0009 — Gateway stateless, sem banco de dados na v1

**Contexto.** Rate limit distribuído, orçamento por chave, histórico de conversas e chaves criadas
em tempo de execução exigem persistência. Nenhum deles foi pedido para a v1.

**Decisão.** A v1 **não tem banco**:

- toda requisição se resolve com a configuração em memória e o provedor;
- chaves do gateway vêm da configuração ([SPEC-007](../specs/SPEC-007-autenticacao.md));
- consumo de tokens vai para o log estruturado ([SPEC-008](../specs/SPEC-008-observabilidade.md)).

**Alternativas consideradas.** Postgres/Redis desde o início: viabiliza rate limit e orçamento, mas
soma infraestrutura, migração e um ponto de falha antes de existir o primeiro consumidor.

**Consequências.**

- Escala horizontal trivial: qualquer réplica atende qualquer requisição.
- **Sem controle de gasto no gateway.** O limite de gasto da v1 é o limite de crédito configurado
  na conta do OpenRouter. Esse é o risco aceito; está no PRD.
- Rate limit, orçamento e chaves dinâmicas entram juntos, quando a persistência entrar, com ADR
  próprio que substitui este.
