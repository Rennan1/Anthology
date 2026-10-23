---
name: anthology-config
description: Use ao mexer na configuração do Anthology — tanto no CONTEÚDO de `anthology.config.json` (criar ou editar Rotas e suas descrições, Modelos, capabilities, fallbacks, o bloco orchestrator, chaves do gateway, o exemplo de configuração) quanto no FORMATO (campo novo, validação nova, padrão novo, seção nova no schema zod). Cobre validações de integridade, JSON Schema gerado, `.env.example`, fixtures de erro e como escrever a descrição de Rota que o orquestrador lê. Use também quando perguntarem "qual modelo atende tal tarefa" ou "como faço o gateway usar o modelo X".
---

# Configuração do Anthology

Formato e validações: [SPEC-002](../../../docs/specs/SPEC-002-arquivo-de-configuracao.md).
Decisão: [ADR-0005](../../../docs/adrs/0005-configuracao-declarativa-em-json.md). Primeiro decida
qual dos dois tipos de mudança é a sua.

## A. Mudar o conteúdo (Rotas, Modelos, chaves)

1. Edite o arquivo de configuração. Os ids casam `^[a-z0-9][a-z0-9._-]{0,63}$`, e `auto` é
   reservado.
2. **Segredo nunca entra no arquivo.** Use o *nome* da variável (`apiKeyEnv`, `keyEnv`) e
   acrescente o nome em `.env.example`, sem valor.
3. `capabilities` honestas: declare só o que o modelo faz **naquele provedor**. Declarar a mais
   leva o fallback a um modelo que recusa a chamada.
4. Valide subindo o gateway (ou o comando de validação de config, quando existir). O boot é a
   validação: erro derruba a subida com o caminho do campo.

### Escrevendo a `description` de uma Rota

**A `description` é instrução funcional, não documentação.** O orquestrador a lê para escolher a
Rota ([SPEC-009](../../../docs/specs/SPEC-009-orquestrador.md)). Mudar uma descrição muda o
roteamento, então ela vai a PR como código.

- Escreva **quando usar**, em termos da tarefa: "Escrever, revisar, depurar ou explicar código e
  SQL", e não "Rota de código".
- Torne as Rotas **mutuamente exclusivas**. Duas descrições que se sobrepõem fazem o orquestrador
  oscilar entre elas.
- Uma Rota deve ser o "resto" ("…qualquer tarefa que não se encaixe nas outras Rotas"), e ela é a
  candidata natural a `orchestrator.defaultRoute`.
- Até 300 caracteres. O orquestrador vê todas as descrições em todo pedido, e isso custa token.

## B. Mudar o formato (schema)

Todo campo novo passa por estes pontos, na ordem:

1. **Schema zod** do campo, com tipo, faixa e padrão.
2. **Validação de integridade**, se o campo referencia outro (id que precisa existir, Capacidade
   exigida).
3. **Fixture inválido** para cada regra nova, com teste que confere: boot com código ≠ 0 e o
   caminho JSON na mensagem. Use um fixture com dois erros para provar que todos são reportados.
4. **JSON Schema regenerado** pelo script de build. O CI falha se o arquivo commitado divergir.
5. **`anthology.config.example.json`** atualizado, e ainda válido.
6. **`.env.example`**, se o campo é um `*Env`.
7. **Tabela da SPEC-002** atualizada no mesmo PR (skill `anthology-docs`).

### Compatibilidade

Enquanto nenhum ambiente real depende do arquivo, troque a forma livremente: sem migração, sem
campo de convivência. Confira no PRD e com o time se já existe consumidor. Quando existir:

- mudança incompatível sobe `version` e vem com migração declarada;
- campo novo em configuração antiga nasce com um padrão que **não esconde** o problema. Na dúvida,
  falhe o boot pedindo o campo, em vez de chutar um valor que pareça válido.

## Armadilhas

- `Object.freeze` no `GatewayConfig`: código que tenta "ajustar" a config em tempo de execução está
  errado. A config só muda no boot.
- Ler `process.env` fora do loader: a resolução de `*Env` acontece num lugar só, no boot.
- `routes.*.enforce` vence a requisição, e `defaults` perde para ela. Use `enforce` para teto e
  `defaults` para preferência.
