---
name: anthology-contrato-openai
description: Use ao implementar, alterar ou depurar o contrato público do Anthology — controllers /v1/chat/completions e /v1/models, validação de parâmetros, tradução de mensagens OpenAI ↔ AI SDK, tools e tool_calls, response_format, imagens, usage, finish_reason, formato de erro, headers x-anthology-*, e o streaming SSE (chunks, [DONE], include_usage, ponto de commit, keep-alive, abort). Use também quando um cliente OpenAI-compatível (SDK openai, LangChain, Open WebUI, Continue) reclamar de uma resposta do gateway, mesmo que a reclamação pareça ser do modelo.
---

# Contrato OpenAI do Anthology

O contrato está em três specs. **Elas são a fonte da verdade; esta skill não repete as tabelas**:

- [SPEC-001](../../../docs/specs/SPEC-001-api-openai-compativel.md): endpoints, parâmetros, resposta, headers, erros.
- [SPEC-005](../../../docs/specs/SPEC-005-traducao-de-mensagens-e-tool-calling.md): tradução de mensagens, tools, imagem, saída estruturada.
- [SPEC-006](../../../docs/specs/SPEC-006-streaming-sse.md): SSE.

## Procedimento

1. **Ache a linha da tabela** da spec que a mudança toca. Se ela não existe, a mudança é de
   comportamento novo: a spec muda primeiro, no mesmo PR (skill `anthology-docs`).
2. **Teste vermelho primeiro** (skill `anthology-testes`):
   - tradução → teste unitário da função pura em `src/openai-compat/translate/`;
   - formato que o cliente vê → teste de contrato com o SDK oficial `openai`.
3. **Implemente** mantendo a tradução em funções puras, sem I/O. Controller só valida, chama e
   escreve a resposta.
4. **Rode** a suíte unitária e a de contrato (Node; também Python se mexeu em stream ou tool call).

## Invariantes que mais quebram

Cada item tem um motivo; não "simplifique" nenhum sem mudar a spec.

1. **`model` no corpo ecoa o valor pedido** (`auto` ou o id da Rota). O modelo real só aparece em
   `x-anthology-model`. Clientes guardam o `model` da resposta e mandam de volta.
2. **Parâmetro conhecido que não honramos → 400 `unsupported_parameter`. Desconhecido → ignora.**
   Ignorar em silêncio um parâmetro conhecido faz o cliente receber um comportamento diferente sem
   saber. As exceções estão documentadas na spec (`user`, `parallel_tool_calls` sem suporte, com
   log).
3. **`function.arguments` é string JSON nos dois sentidos.** Na entrada, `JSON.parse` com 400 e
   `param` apontando o caminho (`messages[2].tool_calls[0].function.arguments`). Na saída,
   `JSON.stringify(input)`.
4. **`toolName` do resultado de tool não vem no formato OpenAI.** Recupere-o do `tool_calls` da
   mensagem `assistant` anterior com o mesmo `id`. Sem correspondência → 400.
5. **`content: null`** quando a resposta só tem `tool_calls`. Alguns clientes quebram com `""`.
6. **SSE:**
   - o chunk com `role` vai antes do primeiro conteúdo;
   - o `index` do tool call é estável, por ordem de primeira aparição;
   - `id` e `name` saem só no primeiro delta daquele `index`;
   - o chunk de `usage` (com `choices: []`) sai só com `include_usage`;
   - `[DONE]` só no fim normal;
   - erro depois do commit vira evento `{"error": …}`, **sem** `[DONE]`.
7. **Nada vai ao cliente antes do Ponto de commit** (primeira parte do upstream). Depois dele, não
   há fallback. Antes dele, o erro é JSON HTTP normal, não SSE.
8. **Erro no formato OpenAI** (`{ error: { message, type, param, code } }`), com status e `code`
   da tabela da SPEC-001. Nunca inclua chave de provedor, corpo do upstream ou stack trace.
9. **Fronteira de módulo:** `OpenAiCompatModule` não importa pacote de provedor, e `RoutingModule`
   não conhece tipos OpenAI. Se precisar cruzar, falta um campo na `GatewayRequest`.

## Depurando reclamação de cliente

1. Reproduza com o SDK oficial `openai` contra o gateway com mock, não com `curl`. O SDK é o juiz
   da compatibilidade.
2. Compare a sequência de eventos SSE (ou o JSON) com a da spec, campo a campo.
3. Se o gateway segue a spec e o cliente ainda quebra, a spec diverge da OpenAI real. Leia a
   referência oficial da OpenAI (fonte, não memória) e proponha a mudança na spec antes do código.
