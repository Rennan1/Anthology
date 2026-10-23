---
name: anthology-tdd
description: Use SEMPRE que for implementar feature, corrigir bug ou mudar comportamento no código do Anthology — é o método de trabalho do projeto (TDD em laço duplo, red-green-refactor, guiado pelos critérios de aceite das specs). Use antes de escrever a primeira linha de código de produção, mesmo em mudança "pequena" ou "óbvia", e ao retomar uma tarefa pela metade. Para técnicas de teste por camada (mock, contrato, SSE, relógio falso), combine com `anthology-testes`.
---

# TDD no Anthology

O projeto trabalha **test-first**. O motivo não é cobertura de linha. As specs de `docs/specs/` já
trazem critérios de aceite numerados, e o TDD é o jeito de transformar cada critério em código
sem escrever nada que nenhum critério pediu. Esta skill aplica ao Anthology o método da skill
global `/tdd`; onde as duas divergirem, vence a Regra 5 do `CLAUDE.md` do time.

## O laço duplo

```text
┌─ laço externo (aceite) ───────────────────────────────────────────┐
│ 1. teste de aceite VERMELHO para o critério da spec                │
│    (contrato com SDK openai, ou mock de ponta a ponta)             │
│  ┌─ laço interno (unidade), repetido ─────────────────────────┐   │
│  │ 2. teste unitário vermelho da próxima peça                  │   │
│  │ 3. o mínimo de código que o deixa verde                     │   │
│  │ 4. refatorar no ato, com tudo verde (anthology-design)      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│ 5. o teste de aceite fica verde → critério cumprido → próximo     │
└───────────────────────────────────────────────────────────────────┘
```

O teste de aceite diz **quando parar**. Os unitários dizem **como chegar**. Feature sem teste de
aceite tende a crescer além do pedido; feature sem unitários tende a ter falha difícil de localizar.

## Passo a passo

1. **Escolha o critério.** Abra a spec e pegue *um* critério de aceite numerado. Se a mudança não
   tem critério, ele nasce primeiro, na spec (skill `anthology-docs`). Sem critério, não há como
   saber quando está pronto.
2. **Escreva o teste de aceite**, na camada mais baixa que ainda prova o critério (tabela de
   camadas em `anthology-testes`). Critério de tradução pura cabe num unitário, e aí os laços
   viram um só.
3. **Rode e veja falhar pelo motivo certo.** A falha tem de ser a asserção ("esperava
   `tool_calls`, veio `undefined`"), não erro de import, de compilação ou de fixture. Em TypeScript,
   crie a assinatura com `throw new Error("não implementado")` para chegar a um vermelho de
   asserção. Um vermelho pelo motivo errado não prova que o teste testa algo.
4. **Laço interno:** teste unitário vermelho, o mínimo de código, verde. *Mínimo* é literal: se
   um `return` fixo passa, o teste está fraco. Escreva o próximo caso que o derruba.
5. **Refatore no ato**, só com tudo verde: nomes, duplicação recém-criada, função longa
   (checklist em `anthology-design`). Refatoração por code smell de código antigo não entra aqui;
   é passe de review.
6. **Aceite verde → rode o portão** (`anthology-portao-qualidade`) e faça commit. Um commit por
   critério cumprido é um bom ritmo.

## Bug

1. Teste que **reproduz** o bug, vermelho, com o sintoma observado.
2. Correção mínima, teste verde.
3. **Revert-check:** `python ~/.claude/scripts/revert_check.py` prova que o teste fica vermelho sem
   a correção. A saída vai no corpo do commit.
4. Pergunte se a mesma causa existe em outro lugar (skill `variant-analysis`).

## O que não passa por TDD

Pela Regra 5: declaração de módulo do Nest, wiring de DI, arquivo de config e wrapper de uma
linha. Eles são cobertos pelos testes de aceite que passam por eles. Se um wiring quebrado não
derruba nenhum teste de aceite, o que falta é teste de aceite, não teste de wiring.

## Sinais de que o ciclo saiu dos trilhos

| sinal | correção |
|---|---|
| escreveu código de produção sem um teste vermelho pedindo | apague ou guarde; escreva o teste; veja-o falhar |
| mudou o teste para ele passar | o teste estava errado *ou* o código estava errado; decida qual com a spec aberta |
| o teste mocka o colaborador interno que você acabou de escrever | ele testa o mock; teste pelo comportamento observável da unidade |
| asserção em chamada de mock que o próprio teste configurou para ser chamada | tautologia; assira o efeito (resposta, evento SSE, log) |
| três ou mais testes verdes seguidos sem nenhum vermelho no meio | os testes não estão empurrando o código; volte ao passo 3 |
| duas rodadas de correção no mesmo arquivo sem caso de uso novo | pare: a peça faz mais do que o pedido (Regra 2) |

## Verde só vale com controle negativo

Antes de declarar uma guarda pronta, quebre de propósito o que ela protege e veja o teste morrer
(a tabela de guardas do projeto está em `anthology-testes`). Se ele não morre, há três suspeitos:
o alvo nem executou, o fixture não chega perto da condição ou a asserção não casou nada.
