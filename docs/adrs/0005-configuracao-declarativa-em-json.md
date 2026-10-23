---
status: aceito
data: 2026-10-22
---

# ADR-0005 — Configuração declarativa em arquivo JSON, validada no boot

**Contexto.** O valor do gateway está em *qual modelo atende qual tarefa*. Essa decisão muda com
frequência (modelo novo, preço novo) e precisa ser revisável em PR, sem código.

**Decisão.**

- Toda a configuração funcional (provedores, modelos, Rotas, chaves do gateway) vive em **um arquivo
  JSON**, `anthology.config.json`, com caminho sobrescrevível por `ANTHOLOGY_CONFIG_PATH`.
- O arquivo é validado por schema (zod) **no boot**. Qualquer erro aborta a subida com mensagem que
  aponta o caminho do campo (fail-fast).
- **Segredos nunca ficam no arquivo.** Campos de segredo guardam o *nome* de uma variável de
  ambiente (`apiKeyEnv`, `keyEnv`), e o valor mora no ambiente ou no cofre. Por isso o arquivo pode
  ser versionado.
- O arquivo é lido **só no boot**. Mudar configuração exige restart.

O formato completo está em [SPEC-002](../specs/SPEC-002-arquivo-de-configuracao.md).

**Alternativas consideradas.**

- *YAML:* aceita comentários, mas o pedido foi JSON, e JSON tem JSON Schema nativo para
  autocompletar no editor.
- *Banco + painel admin:* é o destino provável, mas exige persistência, que a v1 não tem
  ([ADR-0009](0009-gateway-stateless-sem-banco-na-v1.md)).
- *Só variáveis de ambiente:* não comporta a estrutura de Rotas com cadeia de fallback.

**Consequências.**

- O resto do sistema recebe um objeto `GatewayConfig` tipado e já validado e não sabe de onde ele
  veio. Trocar a fonte (banco, hot reload) muda só o loader.
- Um erro de configuração derruba o boot, não a requisição. Rota com alvo inexistente nunca chega
  a produção.
