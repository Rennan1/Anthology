---
name: anthology-portao-qualidade
description: Use antes de declarar qualquer tarefa de código do Anthology como pronta, antes de commit e de abrir PR, e ao configurar ou ajustar o ferramental de qualidade (tsconfig, Biome, dependency-cruiser, jscpd, Jest, Stryker, scripts npm, job de CI). É o portão que transforma os padrões (SOLID, DRY, fronteiras, testes) em verificação executável. Use também quando um check falhar e alguém sugerir afrouxar a regra.
---

# Portão de qualidade do Anthology

Texto em skill **não garante nada**. Garantia é ferramenta que reprova. Esta skill lista o que
reprova, em que ordem rodar e a configuração de referência. Os princípios estão em
`anthology-design` e `anthology-padroes-codigo`; aqui fica o que os cobra.

## O portão

Rode nesta ordem (do mais barato ao mais caro) antes de dizer "pronto":

| # | check | ferramenta | garante | script npm |
|---|---|---|---|---|
| 1 | tipos | `tsc --noEmit` | tipagem estrita, `switch` exaustivo | `typecheck` |
| 2 | lint e formato | Biome | sem `any`, sem promise solta, complexidade ≤ 15, formato | `lint` |
| 3 | fronteiras | dependency-cruiser | o grafo de dependências das specs (abaixo) | `deps` |
| 4 | duplicação | jscpd | nenhum clone novo fora de testes | `dup` |
| 5 | testes | Jest | unitário + mock | `test` |
| 6 | contrato | Jest + SDK `openai` (Node), pytest (Python, venv) | compatibilidade OpenAI | `test:contract` |
| 7 | mutação | Stryker (escopo restrito) | os testes do núcleo pegam mudança de comportamento | `mutation` |
| 8 | smoke real | job do CI com segredo | o provedor oficial funciona | `test:smoke` |

- **Antes de commit:** 1–5.
- **Antes de PR:** 1–6, mais o 7 se o diff toca o núcleo (tradução, roteamento, orquestrador).
- **No CI:** tudo. O 8 sai `nao_verificado` sem segredo.

Os scripts nascem no M0 do PRD. **Até existirem, o check que não rodou é reportado como
`nao_verificado` com o motivo**, nunca como ✅.

## Quando um check falha

Corrija o código, não a regra. Afrouxar uma regra (subir teto de complexidade, ignorar um clone,
liberar um import) exige o porquê escrito no próprio arquivo de config, e o usuário aprova antes.
Silenciar na linha (`biome-ignore`, `// jscpd:ignore`) exige comentário com o motivo.

## Configuração de referência

Confira os nomes de opção na versão instalada de cada ferramenta (doc oficial, via context7)
antes de escrever o arquivo. Abaixo, a intenção de cada um.

### `tsconfig.json`

`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`experimentalDecorators` e `emitDecoratorMetadata` (exigidos pelo Nest).

### Biome (`biome.json`)

Biome é o linter do time em todos os projetos, e o hook `lint-on-edit` o roda a cada edição.
Instale `@biomejs/biome` como devDependency **pinada**. Hoje o hook avisa que não acha o `biome`
no PATH, e assim não verifica nada.

- recomendadas ligadas;
- `suspicious.noExplicitAny`: `error`;
- `nursery.noFloatingPromises`: `error` (está em nursery; confira o grupo na versão instalada);
- `complexity.noExcessiveCognitiveComplexity`: `error`, `maxAllowedComplexity: 15`.

**Armadilha com o Nest:** uma regra que converte import em `import type` quebra a DI. A classe
injetada por construtor precisa existir em tempo de execução para o `emitDecoratorMetadata`.
Confira o comportamento de `style.useImportType` na versão instalada e desligue-o ou restrinja-o,
se for o caso. Confira também se os *parameter decorators* (`@Body()`, `@Inject()`) exigem opção
de parser.

### dependency-cruiser (`.dependency-cruiser.cjs`)

É a garantia executável das fronteiras do [ADR-0002](../../../docs/adrs/0002-backend-em-nestjs.md),
do [ADR-0003](../../../docs/adrs/0003-vercel-ai-sdk-como-camada-de-llm.md) e do
[ADR-0004](../../../docs/adrs/0004-openrouter-como-provedor-oficial-inicial.md). Regras `forbidden`:

| regra | de | não pode depender de |
|---|---|---|
| `routing-nao-conhece-openai` | `src/routing/` | `src/openai-compat/` |
| `providers-nao-conhecem-ninguem` | `src/providers/` | `src/routing/`, `src/openai-compat/` |
| `openai-compat-via-routing` | `src/openai-compat/` | `src/providers/` (exceto tipos públicos do catálogo, se houver) |
| `openrouter-confinado` | qualquer arquivo fora de `src/providers/openrouter/` | `@openrouter/ai-sdk-provider` |
| `ai-sdk-confinado` | fora de `src/providers/`, `src/routing/`, `src/openai-compat/translate/` | `ai` |
| `sem-ciclos` | qualquer | ciclo |
| `teste-nao-vaza` | `src/` (exceto `*.spec.ts`) | `test/`, `ai/test` |

Cada provedor novo acrescenta sua regra `<tipo>-confinado` (skill `anthology-provedor`).

### jscpd

Analisa só `src/`, ignorando `*.spec.ts` (repetição em teste é aceitável por legibilidade). Falha
com qualquer clone acima de ~50 tokens. Um clone legítimo é tratado como na tabela "parecido não é
duplicado" de `anthology-design`: marcado com o motivo, não unido.

### Jest

É o runner padrão do Nest. Os testes unitários ficam ao lado do código (`*.spec.ts`); contrato e
e2e ficam em `test/`. Sem meta de cobertura de linha: o que prova o teste é o controle negativo e
a mutação, não a porcentagem.

### Stryker

Usa o runner de Jest e roda **só no núcleo puro**: `src/openai-compat/translate/`, o merge e a
classificação de erro de `src/routing/` e o recorte do orquestrador. O limiar de quebra começa no
**primeiro valor medido** e só sobe (catraca). O valor e o comando que o gerou vão no corpo do
commit que configurar a ferramenta.

## Relação com os hooks globais

| hook | o que faz aqui |
|---|---|
| `lint-on-edit` | roda o Biome em cada arquivo editado (precisa do `biome` instalado) |
| `typecheck-on-stop` | só cobre Python (mypy); o `tsc` deste projeto é o check 1, rodado por você |
| `secret-scan` | procura segredo hardcoded; precisa do `kingfisher` no PATH |
| `pr-gate` | recusa PR sem os três gates (review independente, verify, ci-repro) no HEAD |

Um hook que avisa "não verifica nada" não é proteção. Diga isso na entrega, com o hook e o binário
que faltam.
