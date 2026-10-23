---
name: anthology-design
description: Use ao desenhar, refatorar ou revisar a estrutura do código do Anthology — onde uma responsabilidade mora, se cabe uma interface ou abstração nova, se algo é duplicação, como um módulo NestJS depende de outro. Aplica SOLID, DRY, KISS, YAGNI e núcleo-funcional/casca-imperativa às fronteiras reais deste gateway (tradução, roteamento, orquestrador, provedores, config). Use no passo de refatoração do TDD, antes de criar classe/interface/helper novo, e quando alguém disser "isso viola SOLID", "isso está duplicado" ou "vamos generalizar".
---

# Design no Anthology: SOLID, DRY, KISS, YAGNI

Os princípios existem para **baratear a próxima mudança**. Eles não são metas em si. Por isso,
aqui cada princípio está amarrado a uma fronteira concreta do gateway, e há uma régua que vence
todas: **sem abstração especulativa** (Regra 2 do time). Uma interface nasce com dois usos reais,
não com um uso e uma esperança.

## Mapa de responsabilidades (SRP)

Cada peça tem **um motivo para mudar**:

| peça | muda quando… | não deve saber de… |
|---|---|---|
| controller (`src/openai-compat/*.controller.ts`) | o contrato HTTP muda | provedor, Rota, AI SDK |
| tradução (`src/openai-compat/translate/`) | o formato OpenAI ou o do AI SDK muda | HTTP, Nest, config |
| SSE writer | o formato do stream muda | qual modelo atendeu |
| roteamento (`src/routing/`) | a regra de escolha de candidato ou de fallback muda | formato OpenAI |
| orquestrador (`src/routing/orchestrator/`) | a regra de escolha de Rota muda | formato OpenAI, provedor concreto |
| provedores (`src/providers/<tipo>/`) | a integração com aquele provedor muda | Rotas, OpenAI |
| config (`src/config/`) | o formato do JSON muda | quem consome cada campo |

**Cheiro:** uma função que traduz **e** chama o provedor, ou que decide fallback **e** escreve SSE.
Separe pela tabela.

## SOLID aplicado

- **O — aberto para extensão onde a extensão é real.** O Anthology tem dois pontos de extensão de
  verdade:
  - provedor novo, que é um arquivo novo de `ProviderFactory`;
  - Rota ou Modelo novo, que é uma entrada na configuração, sem código.

  Fora deles, não crie plugin, estratégia nem registry "para o futuro". Um `switch (type)` sobre
  provedores fora do registro de fábricas é violação, porque obriga a editar código existente para
  cada provedor.
- **L — substituição.** Toda `ProviderFactory`, inclusive a `mock`, honra o mesmo contrato:
  - `apiKey` vem só da entrada;
  - erro HTTP vira `APICallError` com `statusCode`;
  - `providerOptions` são lidas sob o `optionsNamespace`.

  Isso se garante por teste: a mesma suíte de contrato roda parametrizada sobre todas as
  fábricas. Uma fábrica que precisa de exceção na suíte quebra o L.
- **I — interfaces estreitas.** O roteamento depende de `ModelCatalog.get(id)`, nunca do registry
  do AI SDK. O orquestrador recebe as Rotas elegíveis, não a config inteira. Injete o pedaço que o
  consumidor usa.
- **D — dependa da abstração, com o mecanismo do Nest.** Interface de TypeScript some em tempo de
  execução, então a DI do Nest não a enxerga. Injete por token (`Symbol`) ou classe abstrata:
  `@Inject(MODEL_CATALOG) catalog: ModelCatalog`. O módulo de alto nível (roteamento) nunca
  importa a implementação concreta (registry, OpenRouter).
- **S** está no mapa acima.

## DRY: conhecimento, não texto

DRY é sobre **uma fonte para cada pedaço de conhecimento**, não sobre trechos parecidos. Estas são
as fontes únicas do projeto. Duplicar qualquer uma é bug esperando acontecer:

| conhecimento | fonte única | derivados (gerados ou inferidos, nunca reescritos à mão) |
|---|---|---|
| formato da config | schema zod | tipos (`z.infer`), JSON Schema gerado, validação |
| formato da requisição OpenAI | schema zod de entrada | tipos do controller |
| tabela de erros (SPEC-001) | um mapa `code → { status, type }` | o exception filter e os testes de erro |
| `finishReason` → `finish_reason` | um mapa | resposta, SSE e log |
| lista de Capacidades | um `as const` | schema da config, filtro do roteamento |
| ids reservados (`auto`) | uma constante | validação da config, roteamento, `/v1/models` |

**Parecido não é duplicado.** O fallback de Rota (SPEC-003: só erro retentável passa adiante) e o
do orquestrador (SPEC-009: qualquer erro passa adiante) são dois conhecimentos. Uni-los numa
função com flag acopla duas regras que mudam por motivos diferentes. Mantenha separados, com um
comentário de uma linha dizendo por quê.

**Regra de três para helper:** a primeira vez se escreve, a segunda se tolera, a terceira se
extrai. A exceção é conhecimento da tabela acima, que nasce único desde o começo.

## KISS e YAGNI

- **YAGNI:** a seção "Fora de escopo" de cada spec é a lista oficial do que não construir, nem
  "deixar preparado". Gancho para hot reload, rate limit, multiagente ou cache de decisão é código
  morto até o ADR que o pedir.
- **KISS:** a solução certa é a mais simples que cumpre o critério de aceite. Um `if` legível
  vence um padrão de projeto.

## Núcleo funcional, casca imperativa

A lógica do gateway é quase toda decisão sobre dados, e por isso cabe em **funções puras**:
tradução, recorte do orquestrador, merge de parâmetros, classificação de erro, filtro de
Capacidade. I/O (HTTP, provedor, log, relógio) fica na casca: controller, serviço de roteamento,
SSE writer. Ganhos: a função pura se testa sem mock, e a casca fica fina.

**Cheiro:** `Date.now()`, `process.env`, `logger` ou `await` dentro de uma função de tradução.

## Composição, não herança

Sem hierarquia de classes de provedor ou de erro além de um nível: um `GatewayError` com `code` é
o bastante. Comportamento compartilhado entra por função ou por injeção.

## Checklist do passo de refatoração

- [ ] Cada função nova cabe numa linha do mapa de responsabilidades?
- [ ] Alguma interface ou abstração nova tem só um uso? Se sim, desfaça.
- [ ] Algum conhecimento da tabela DRY foi reescrito em vez de importado?
- [ ] Algo que parece duplicado é, na verdade, duas regras? Se for, documente; não una.
- [ ] Há I/O dentro do núcleo puro?
- [ ] O dependency-cruiser segue verde? A fronteira entre módulos é garantida por ferramenta
      (`anthology-portao-qualidade`), não por esta lista.
