---
name: anthology-provedor
description: Use ao adicionar, alterar ou remover um provedor de LLM no Anthology (OpenRouter, Anthropic, OpenAI, Google, Bedrock, Ollama, Groq, qualquer endpoint OpenAI-compatible), ao mexer numa ProviderFactory, no registry, no ModelCatalog ou nos providerOptions de um provedor, e ao promover um provedor de experimental para oficial. Use também quando alguém pedir "suporte ao provedor X" ou "usar o modelo Y que não está no OpenRouter".
---

# Provedores no Anthology

Contrato e regras: [SPEC-004](../../../docs/specs/SPEC-004-camada-de-provedores.md). Decisões:
[ADR-0003](../../../docs/adrs/0003-vercel-ai-sdk-como-camada-de-llm.md) e
[ADR-0004](../../../docs/adrs/0004-openrouter-como-provedor-oficial-inicial.md).

**O teste do desenho:** um provedor novo entra **sem diff** em `src/openai-compat/` e em
`src/routing/`. Se você se pegar editando esses módulos para um provedor funcionar, pare. A
interface `ProviderFactory` está errada, e a mudança dela pede ADR.

## Antes de começar

- Confira se o modelo desejado não está disponível pelo OpenRouter. Se estiver, basta uma entrada
  em `models` na configuração (skill `anthology-config`), sem provedor novo.
- Ache o pacote oficial do provedor para o AI SDK (`@ai-sdk/<nome>`, ou `@ai-sdk/openai-compatible`
  para endpoints compatíveis). Confira a API da versão que vai pinar (skill `anthology-ai-sdk`).

## Passo a passo

1. Instale o pacote **com versão exata**.
2. Crie `src/providers/<tipo>/<tipo>.factory.ts` implementando `ProviderFactory`:
   - `type`: o valor de `providers.<id>.type` no JSON;
   - `optionsNamespace`: a chave que o pacote lê em `providerOptions` (confira na doc);
   - `optionsSchema`: zod **estrito** das opções extras (vazio se não houver);
   - `create(...)`: recebe `apiKey` já resolvida. A fábrica nunca lê `process.env`.
3. Registre a fábrica no `ProvidersModule`.
4. Acrescente a regra `<tipo>-confinado` no `.dependency-cruiser.cjs`, liberando o pacote só em
   `src/providers/<tipo>/` (skill `anthology-portao-qualidade`).
5. Escreva testes de contrato da fábrica com o mock (skill `anthology-testes`):
   - `providerOptions` chegam sob o `optionsNamespace`;
   - `modelId` inválido derruba o boot;
   - erro HTTP do provedor vira `APICallError` com `statusCode`, para o fallback classificar.
6. Adicione um exemplo comentado do provedor na documentação. Ele só entra em
   `anthology.config.example.json` quando o provedor for oficial.

O provedor está **experimental** depois do passo 5.

## Promover a oficial

Exige três coisas, nenhuma opcional:

1. Smoke test **real** no CI: completion, stream e um tool call, contra um modelo barato do
   provedor, com a chave em segredo do CI. Sem o segredo, o job sai `nao_verificado`, nunca verde.
2. Exemplo em `anthology.config.example.json` e a variável em `.env.example`.
3. Atualização do ADR-0004, ou ADR novo que o substitua, dizendo que o OpenRouter deixou de ser o
   único oficial. Isso muda o risco de ponto único de falha no PRD (skill `anthology-docs`).

## Armadilhas

- **Chave em `headers` ou `options`:** o loader rejeita, e deve rejeitar. A chave entra por
  `apiKeyEnv`.
- **Capacidades declaradas a mais:** `capabilities` na configuração precisa refletir o que o
  modelo faz de verdade **por aquele provedor**. O mesmo modelo pode ter tools num provedor e não
  ter em outro. Declarar demais faz o fallback cair num modelo que recusa a chamada.
- **Mock como prova de provedor:** mock prova tradução e roteamento. Só o smoke real prova que o
  provedor funciona.
- **Fábrica `mock` vazando:** ela só existe com `NODE_ENV=test`. Fora disso, `type: "mock"` é
  rejeitado no boot.
