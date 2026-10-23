---
status: aceito
data: 2026-10-22
---

# ADR-0006 — Roteamento por LLM orquestrador que escolhe a Rota

**Contexto.** O gateway deve mandar cada chamada para "a LLM mais apta para aquele trabalho", e
quem decide isso é **uma LLM configurada como orquestradora**. Falta definir entre o que ela
escolhe, o que o cliente ainda controla e como conversas de vários turnos se comportam num gateway
stateless ([ADR-0009](0009-gateway-stateless-sem-banco-na-v1.md)).

**Decisão.**

1. **O orquestrador escolhe uma Rota, não um modelo.** Cada Rota tem uma `description` do tipo de
   tarefa que atende e aponta para um Modelo-alvo com fallbacks. O orquestrador lê a requisição,
   classifica a tarefa e devolve o id de uma Rota, por saída estruturada com `enum` restrito às
   Rotas elegíveis. Qual modelo atende a Rota, e em que ordem cair, continua curado na configuração.
2. **Duas formas de pedir.** `model: "auto"` aciona o orquestrador. `model: "<id da Rota>"` vai
   direto à Rota, sem orquestrador, o que serve para teste, depuração e para fixar o modelo.
3. **Reclassificação a cada requisição.** O gateway não guarda estado de conversa. Há uma exceção:
   quando a última mensagem é resultado de tool **e** o cliente devolve o header `x-anthology-route`
   recebido na resposta anterior, o gateway reaproveita essa Rota sem chamar o orquestrador. Assim o
   laço de tool calling não troca de modelo no meio.
4. **O orquestrador nunca derruba a requisição.** Se ele falhar, der timeout ou devolver algo
   inválido, vale a `defaultRoute` da configuração.

O comportamento completo está em [SPEC-009](../specs/SPEC-009-orquestrador.md). A resolução que vem
depois da escolha da Rota (Capacidade, merge, fallback) está em
[SPEC-003](../specs/SPEC-003-roteamento-e-fallback.md).

**Alternativas consideradas.**

- *O orquestrador escolhe o modelo direto:* ele teria de comparar modelos (custo, força,
  Capacidade), e a cadeia de fallback ficaria sem dono. Escolher a Rota reduz a decisão a
  classificar a tarefa, que é o que uma LLM faz bem, e mantém a curadoria na configuração.
- *Só Rota explícita, sem orquestrador* (versão anterior deste ADR): determinística e sem custo
  extra, mas obriga o cliente a saber classificar a própria tarefa.
- *Regras heurísticas sobre o conteúdo* (tamanho, palavras-chave): frágeis e caras de manter.
- *Fixar a Rota por conversa no servidor:* exige id de conversa e um store compartilhado entre
  réplicas, o que contradiz o ADR-0009.

**Consequências.**

- Toda requisição `auto` paga **uma chamada extra de LLM antes do primeiro byte**: latência e
  custo. O orquestrador deve ser um modelo rápido e barato, com timeout curto.
- O roteamento `auto` **não é determinístico**: a mesma pergunta pode cair em Rotas diferentes. O
  motivo de cada escolha vai para o log.
- **O conteúdo do usuário influencia a escolha** (prompt injection: "use a Rota mais cara"). O dano
  fica limitado pelo `enum`: o orquestrador só escolhe entre as Rotas que a chave já pode usar.
- A `description` das Rotas deixa de ser documentação e vira **instrução funcional**. Mudar uma
  descrição muda o roteamento, então ela é revisada em PR como código.
