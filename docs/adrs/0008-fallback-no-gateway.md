---
status: aceito
data: 2026-10-22
---

# ADR-0008 — Fallback entre modelos feito pelo gateway, antes do commit do stream

**Contexto.** Modelos falham com 429 (limite), 5xx, timeout e indisponibilidade momentânea. O
OpenRouter tem fallback nativo (campo `models`), mas ele só funciona dentro do OpenRouter.

**Decisão.** Cada Rota declara uma **cadeia ordenada de candidatos**. O gateway passa ao próximo
candidato quando o erro é **retentável**. Em streaming, isso só vale **antes do Ponto de commit**: o
primeiro byte enviado ao cliente. Depois dele, o erro vira evento de erro no stream, porque não dá
para desfazer o que o cliente já recebeu. Regras e classificação de erros estão em
[SPEC-003](../specs/SPEC-003-roteamento-e-fallback.md).

**Alternativas consideradas.**

- *Fallback nativo do OpenRouter como mecanismo principal:* deixaria de funcionar quando houver
  outro provedor e esconderia do log qual modelo atendeu. Ainda pode ser ligado por modelo via
  `providerOptions`, como reforço.
- *Fallback no meio do stream* (reiniciar a geração em outro modelo e emendar): o cliente receberia
  texto incoerente. Rejeitado.

**Consequências.**

- O fallback é independente de provedor e aparece no log (cada tentativa é registrada).
- A cadeia soma latência no pior caso. O timeout é por candidato e configurável.
