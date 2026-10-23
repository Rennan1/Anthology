---
name: anthology-padroes-codigo
description: Use ao escrever ou revisar qualquer código TypeScript/NestJS do Anthology — tipagem estrita, validação de entrada externa com zod, tratamento de erro, async e AbortSignal, imutabilidade, nomes (incluindo o mapa do glossário do PRD para identificadores em inglês), estrutura de módulo/provider/controller do Nest, logging estruturado, comentários e convenção de arquivos e commits. Use também quando houver dúvida de "como se escreve isso aqui", antes de criar arquivo novo.
---

# Padrões de código do Anthology

Padrão é o que torna o código de um autor legível para outro. Onde o repo já tiver uma convenção
estabelecida, **ela vence esta lista** (Regra 0). Esta lista vale até o código existir e preenche o
que ele não cobrir.

## Nomes: o glossário vira código

O PRD fala português; o código fala inglês. Use **sempre** este mapa, para que o termo da spec e o
identificador sejam encontráveis um a partir do outro:

| glossário (PRD) | código |
|---|---|
| Rota | `Route`, `routeId` |
| Modelo (da config) | `ModelConfig`, `modelKey` |
| Modelo upstream | `upstreamModelId` |
| Modelo-alvo | `target` |
| Candidato | `Candidate` |
| Capacidade | `Capability` |
| Rota elegível | `eligibleRoutes` |
| Orquestrador | `Orchestrator` |
| Continuação | `continuation` |
| Ponto de commit | `commitPoint` / `committed` |
| Chave do gateway | `GatewayKey`, `keyId` |
| Provedor | `Provider`, `ProviderFactory` |

Nome diz a intenção (`selectEligibleRoutes`, não `filterRoutes2`). Booleano em forma de pergunta
(`isRetryable`, `hasCapability`).

## TypeScript

- `tsconfig`: `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`.
- **Sem `any`.** Dado de fora é `unknown` até passar por um schema zod. "De fora" inclui corpo
  HTTP, arquivo de config, variável de ambiente e **resposta de provedor**: entrada externa é
  desconfiada por padrão.
- **Uniões discriminadas com `switch` exaustivo.** Partes do stream, `finishReason` e `routedBy`
  terminam em `default: assertNever(x)`. Assim, um caso novo vindo do AI SDK quebra a compilação
  em vez de cair em silêncio no `default`.
- `readonly` em campos e `as const` em tabelas. O `GatewayConfig` é congelado no boot.
- Tipos derivados, não duplicados: `z.infer<typeof schema>` em vez de reescrever a interface.

## Erros

- Lance `GatewayError` com um `code` da tabela da SPEC-001. Nunca lance string nem `Error`
  genérico em fluxo esperado.
- **Um** exception filter converte `GatewayError` no formato OpenAI. Controller e serviço não
  montam corpo de erro.
- Preserve a causa: `new GatewayError("upstream_unavailable", { cause: err })`.
- Sem `catch` vazio. Sem `catch` que só loga e segue, exceto onde a spec manda (orquestrador →
  `defaultRoute`), e aí com log.
- Mensagem de erro nunca contém segredo, corpo do upstream nem stack.

## Async

- Nenhuma promise solta (Biome `noFloatingPromises`).
- Todo I/O upstream recebe o `AbortSignal` da requisição. Uma função que chama provedor sem
  receber `signal` está errada.
- Timeout por `AbortSignal.timeout()` combinado com o sinal do cliente, não `setTimeout` solto.

## NestJS

- Uma pasta por módulo, com `*.module.ts`, `*.controller.ts`, `*.service.ts` e `*.factory.ts`.
  O teste unitário fica ao lado (`*.spec.ts`); contrato e e2e ficam em `test/`.
- **Injeção só por construtor.** Sem `ModuleRef.get` como service locator, sem singleton estático,
  sem `new` de serviço dentro de serviço.
- Interface injetável → token `Symbol` exportado junto da interface (ver `anthology-design`).
- Controller fino: valida com pipe zod, chama um serviço, devolve. Sem regra de negócio.
- Validação de entrada **com zod**, não `class-validator`. É uma fonte de schema só, já usada na
  config (SPEC-001, SPEC-002).

## Logging

- Logger pino injetado. Campos estruturados (`logger.info({ route, keyId }, "routing.completed")`),
  nunca string concatenada.
- Os nomes de evento e de campo são os da SPEC-008.
- **Conteúdo de conversa, chave e `reason` do orquestrador nunca entram em log** fora da flag
  `includeContent`.

## Funções e comentários

- Função curta, com um propósito. A complexidade cognitiva tem teto de 15 (Biome); passou disso,
  divida pela tabela de responsabilidades.
- Comentário explica **por quê**, não o quê. A densidade segue a do arquivo tocado.
- Regra de negócio que vem de spec ganha um comentário curto com a referência
  (`// SPEC-003: 4xx exceto 408/429 não é retentável`). A spec é o porquê longo.

## Commits

Conventional Commits, com escopo do módulo: `feat(routing): …`, `fix(openai-compat): …`,
`test(orchestrator): …`, `chore(deps): …`. Revert-check, mutação e medições vão no **corpo**.
