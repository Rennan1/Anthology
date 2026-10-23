---
name: anthology-docs
description: Use sempre que uma mudança no Anthology altera comportamento descrito em docs/ ou toma uma decisão de arquitetura — atualizar spec (tabelas e critérios de aceite) no mesmo PR do código, criar, aceitar ou substituir ADR, adicionar requisito (RF/RNF) ao PRD, criar spec nova, responder uma questão em aberto (Q-xx) ou mudar um marco. Inclui o script que verifica links, âncoras e a rastreabilidade PRD ↔ specs ↔ ADRs; rode-o antes de entregar qualquer edição em docs/.
---

# Documentação do Anthology

```text
docs/
├── PRD.md     o quê e por quê: requisitos, índices de ADRs e specs, marcos, riscos, questões
├── adrs/      NNNN-slug.md — decisões difíceis de reverter
└── specs/     SPEC-NNN-slug.md — comportamento, com critérios de aceite verificáveis
```

## Quando cada documento muda

| aconteceu | o que fazer |
|---|---|
| o código mudou um comportamento descrito numa spec | atualize a tabela **e** o critério de aceite da spec no mesmo PR |
| decisão difícil de reverter, surpreendente sem contexto **e** fruto de um trade-off real | ADR novo (as três condições, senão não é ADR) |
| decisão antiga mudou | ADR novo com `status: substituído por ADR-NNNN` no antigo; **nunca apague** um ADR |
| requisito novo | linha RF/RNF no PRD + a spec dona, com o id no frontmatter `requisitos` |
| questão Q-xx respondida | registre a resposta onde ela vive (ADR ou spec) e tire a linha do PRD; não renumere as outras |
| spec nova | próximo `SPEC-NNN`, frontmatter completo, linha no índice do PRD |

Spec e código divergem? Para "o que acontece hoje", o código vence. Mas a divergência é um bug ou
uma spec desatualizada, e quem decide qual dos dois é o time: pergunte, não escolha em silêncio.

## Formatos

**ADR**: frontmatter `status` (`proposto` | `aceito` | `deprecado` | `substituído por ADR-NNNN`) e
`data`. Título `# ADR-NNNN — <decisão>`. Corpo com **Contexto**, **Decisão**, **Alternativas
consideradas** e **Consequências**. Use as duas últimas só quando houver o que dizer.

- **Status:** ADR que você escreve nasce `proposto`. Só vira `aceito` com aprovação explícita do
  usuário ou do time, e o índice do PRD acompanha.
- **Número:** o próximo da sequência, sem buracos.

**Spec**: frontmatter `id`, `titulo`, `status`, `adrs: [...]`, `requisitos: [...]`. Seções:
Objetivo, comportamento (tabelas), **Critérios de aceite** (numerados, cada um testável, com
controle negativo quando é uma guarda) e Fora de escopo.

**Rastreabilidade:** o conjunto `requisitos` do frontmatter de cada spec é **igual** ao conjunto de
linhas RF/RNF do PRD que citam aquela spec. O script confere.

## Verificação

Rode antes de entregar qualquer edição em `docs/`:

```bash
python -I .claude/skills/anthology-docs/scripts/check_docs.py docs
```

O script confere:
- links `.md` e âncoras;
- numeração e status dos ADRs;
- o id das specs contra o nome do arquivo;
- se todo ADR e toda spec aparecem nos índices do PRD, com o mesmo status;
- a igualdade spec ↔ requisitos.

Sai 0 sem problemas e 1 com a lista de problemas. Problema reportado se corrige, não se ignora.
