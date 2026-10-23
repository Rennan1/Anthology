---
status: aceito
data: 2026-10-22
---

# ADR-0007 — Tool calling transparente: o gateway não executa tools

**Contexto.** Clientes OpenAI-compatíveis mandam `tools` e esperam receber `tool_calls`, executar
as tools do lado deles e devolver `role: "tool"` na próxima requisição. O AI SDK também consegue
executar tools no servidor (`execute`) e rodar laços de múltiplos passos.

**Decisão.** O gateway é **transparente** para tools:

- converte cada tool OpenAI em `tool({ description, inputSchema: jsonSchema(parameters) })`
  **sem `execute`**;
- roda **um único passo** de geração;
- devolve as chamadas como `tool_calls` no formato OpenAI.

O laço agente ↔ tool é do cliente. A tradução está em [SPEC-005](../specs/SPEC-005-traducao-de-mensagens-e-tool-calling.md).

**Alternativas consideradas.** Tools executadas pelo gateway (servidores MCP, tools de servidor):
exigem estado de conversa, sandbox e permissões por chave. Ficam fora da v1, e o desenho atual não
fecha essa porta.

**Consequências.**

- O gateway segue stateless ([ADR-0009](0009-gateway-stateless-sem-banco-na-v1.md)).
- A tradução precisa preservar fielmente o `tool_call_id` entre turnos. O AI SDK exige `toolName`
  no resultado da tool, que o formato OpenAI não traz. O gateway o recupera do `tool_calls` da
  mensagem `assistant` anterior com o mesmo id.
