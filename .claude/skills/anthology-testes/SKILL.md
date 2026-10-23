---
name: anthology-testes
description: Use ao escrever, corrigir ou revisar testes do Anthology, ou ao decidir como provar que uma mudança funciona — testes unitários das funções puras (tradução, recorte do orquestrador, merge de parâmetros), testes com o modelo mock do AI SDK roteirizado (fallback, streaming, orquestrador), testes de contrato com o SDK oficial `openai` em Node e Python, smoke test real contra o OpenRouter, controle negativo, relógio falso para timeout e keep-alive. Use antes de declarar qualquer feature ou correção do gateway como pronta. O fluxo (quando escrever cada teste) está em `anthology-tdd`; esta skill é o COMO testar cada coisa.
---

# Testes do Anthology

Os critérios de aceite de cada spec em `docs/specs/` **são** a lista de testes. Cada critério
numerado vira pelo menos um teste. Comece pelo critério e escreva o teste vermelho antes do código.

## Camadas: o que cada uma prova

| camada | prova | **não** prova | usa rede? |
|---|---|---|---|
| unitário puro | tradução, recorte do orquestrador, merge, classificação de erro | integração com Nest e com o SDK | não |
| mock do AI SDK | roteamento, fallback, Capacidade, SSE, orquestrador, abort | que o provedor real se comporta assim | não |
| contrato (SDK `openai`) | que um cliente real entende o que o gateway emite | o provedor | não (mock atrás) |
| smoke real | que o provedor oficial funciona de ponta a ponta | casos de borda | **sim** |

**Mock conta zero como prova de provedor.** Um teste verde com mock nunca autoriza escrever
"funciona com o OpenRouter".

## Regras

1. **O nome do mock vem da versão pinada.** O modelo mock fica em `ai/test`; confira o nome
   exportado (skill `anthology-ai-sdk`). Roteirize o mock por teste: resposta, sequência de partes
   do stream, erro com `statusCode`, atraso.
2. **Fallback e orquestrador se provam contando chamadas.** "O fallback não foi chamado" é uma
   asserção de zero chamadas no mock do candidato, não a ausência de erro. Idem para "zero chamadas
   ao orquestrador" na continuação (SPEC-009).
3. **Stream se prova pela sequência exata de eventos SSE**, comparada inteira: `role`, deltas,
   `finish_reason`, `usage`, `[DONE]`. Contar eventos não basta.
4. **Contrato usa o SDK oficial**, não um parser de SSE escrito à mão. O teste é "o `openai`
   entende", e só o próprio SDK responde isso.
   - Node: o pacote `openai` como devDependency, com versão pinada.
   - Python: o pacote `openai` num **venv** do projeto. O teto de ambiente é venv/nvm + docker,
     nada além disso sem permissão.
5. **Tempo é relógio falso.** Timeout de candidato, `timeoutMs` do orquestrador e `: keep-alive` a
   cada 15 s se testam com fake timers, nunca com `sleep`.
6. **Nenhum teste unitário ou de contrato chama a rede.** Custo e instabilidade. Só o smoke real
   chama o OpenRouter, e só no job dele.
7. **Smoke real sem segredo sai `nao_verificado`**, nunca verde e nunca pulado em silêncio.

## Controle negativo

O teste só vale se morrer quando o que ele protege quebra. Para cada guarda, quebre de propósito
uma vez e veja o teste ficar vermelho:

| guarda | quebra de propósito |
|---|---|
| conteúdo fora do log (SPEC-008) | logar o prompt → o teste da sentinela `SENTINELA-123` precisa falhar |
| chave fora do log (SPEC-007) | logar o header `Authorization` → o teste precisa falhar |
| fronteira de import (SPEC-004) | importar `@openrouter/ai-sdk-provider` fora da pasta → o dependency-cruiser precisa falhar |
| `enum` do orquestrador (SPEC-009) | incluir uma Rota proibida para a chave → o teste do schema precisa falhar |
| fallback só retentável (SPEC-003) | tratar 400 como retentável → o teste "zero chamadas ao fallback" precisa falhar |

Em correção de bug, rode `~/.claude/scripts/revert_check.py`: o teste novo precisa ficar vermelho
com o fix revertido. Ponha a saída no corpo do commit.

## Antes de declarar pronto

- Os critérios de aceite da spec tocada têm teste e passam.
- O controle negativo de cada guarda nova foi feito, e está registrado no commit.
- Se mexeu em stream ou tool call: a suíte de contrato passou em Node **e** Python.
- Se mexeu em provedor: o smoke real passou, ou está declarado `nao_verificado` com o motivo.
