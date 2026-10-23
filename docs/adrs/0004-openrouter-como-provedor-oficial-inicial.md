---
status: aceito
data: 2026-10-22
---

# ADR-0004 — OpenRouter como provedor oficial inicial

**Contexto.** O OpenRouter dá acesso a centenas de modelos de vários fornecedores com uma chave só.
Isso permite que as Rotas apontem para o modelo mais apto de cada tarefa sem o time manter contrato
com cada fornecedor.

**Decisão.** O **OpenRouter** é o único provedor com **suporte oficial** na v1, integrado pelo
pacote `@openrouter/ai-sdk-provider` (`createOpenRouter`). Suporte oficial significa três coisas:

1. ter fábrica no `ProvidersModule`;
2. passar no smoke test contra o provedor **real** no CI;
3. estar documentado no exemplo de configuração.

Qualquer outro provedor plugado pela mesma interface é *experimental* até cumprir os três
([SPEC-004](../specs/SPEC-004-camada-de-provedores.md)).

**Alternativas consideradas.** Integrar direto OpenAI, Anthropic e Google desde o início daria mais
controle (sem intermediário), mas triplicaria chaves, contratos e testes antes de existir o primeiro
consumidor.

**Consequências.**

- **O OpenRouter vira ponto único de falha na v1.** O fallback do
  [ADR-0008](0008-fallback-no-gateway.md) cobre a falha de *um modelo*, não a queda do OpenRouter.
  Isso só muda quando houver um segundo provedor oficial.
- O OpenRouter também roteia (`openrouter/auto`, `provider.order`, fallback `models`). O Anthology
  **não depende** desses recursos: a escolha do modelo é do orquestrador e das Rotas do próprio
  Anthology ([ADR-0006](0006-roteamento-por-orquestrador.md)).
  Eles podem ser usados de forma explícita via `providerOptions` no modelo configurado.
- Nenhum arquivo fora de `src/providers/openrouter/` importa `@openrouter/ai-sdk-provider`. Uma
  regra do dependency-cruiser no CI garante isso, para o código de roteamento não vazar
  dependência do provedor.
