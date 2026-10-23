# AGENTS.md — Anthology

Instruções para qualquer agente de IA (Claude, Codex, Cursor, Copilot) que trabalhe neste repo.
Aqui fica **como se trabalha** no projeto. **Como o sistema funciona** está em `docs/`.

## O que é

Gateway HTTP com **API compatível com a OpenAI** (`/v1/chat/completions`, `/v1/models`). Com
`model: "auto"`, uma LLM orquestradora escolhe a Rota (o tipo de tarefa), e a Rota define qual
modelo atende e para quais cair em caso de falha. Tudo é configurado num JSON. O stack é NestJS
(TypeScript estrito) com o Vercel AI SDK, e o OpenRouter é o provedor oficial da v1.

**Estado atual:** só documentação. O código começa no marco M0 do PRD. Comando, pasta ou script
citado abaixo que ainda não exista é **o alvo do M0**, não algo para inventar de outra forma.

## Fonte da verdade

| pergunta | onde |
|---|---|
| o quê e por quê, requisitos, marcos, riscos, glossário | [docs/PRD.md](docs/PRD.md) |
| como uma parte se comporta, com critérios de aceite | [docs/specs/](docs/specs/) |
| por que foi decidido assim (e o que foi rejeitado) | [docs/adrs/](docs/adrs/) |
| como fazer cada tipo de tarefa (playbooks) | [.claude/skills/](.claude/skills/), legíveis por qualquer agente |

Spec e código divergem? Para "o que acontece hoje", vale o código. Mas a divergência é um bug ou
uma spec desatualizada: **pergunte** qual dos dois, não escolha em silêncio. Decisão de ADR não se
contorna no código; muda-se com um ADR novo.

## Regras de trabalho

1. **TDD sempre.** Escolha um critério de aceite da spec, escreva o teste vermelho, veja-o falhar
   pelo motivo certo, escreva o mínimo para passar e refatore com tudo verde. Bug começa por teste
   que o reproduz. Playbook: `anthology-tdd`.
2. **A spec muda no mesmo PR que o comportamento.** Comportamento novo sem critério de aceite na
   spec não começa. Decisão difícil de reverter vira ADR, que nasce `proposto` e só vira `aceito`
   com aprovação humana. Playbook: `anthology-docs`.
3. **Fronteiras de módulo são lei.** O grafo é
   `openai-compat → routing (+ orquestrador) → providers`. O roteamento não conhece o formato
   OpenAI. Pacote de provedor só aparece em `src/providers/<tipo>/`. O dependency-cruiser cobra
   isso.
4. **AI SDK: confira a API da versão pinada, nunca escreva de memória.** Os nomes mudam entre
   majors. Playbook: `anthology-ai-sdk`.
5. **Sem abstração especulativa.** Interface nasce com dois usos reais. A seção "Fora de escopo"
   de cada spec é a lista do que não construir, nem "deixar preparado". DRY é sobre conhecimento,
   não sobre trechos parecidos. Playbook: `anthology-design`.
6. **Segredo nunca em arquivo, log, resposta ou commit.** A config guarda o *nome* da variável de
   ambiente (`apiKeyEnv`, `keyEnv`). Conteúdo de conversa não vai para o log, salvo com a flag
   `includeContent`.
7. **Entrada externa é `unknown` até passar por zod.** Isso vale para corpo HTTP, config, env e
   resposta de provedor.
8. **Pronto = portão verde.** `typecheck` → `lint` → `deps` → `dup` → `test` → `test:contract`
   (→ `mutation` no núcleo). Check que não rodou é reportado como `nao_verificado` com o motivo,
   nunca como ✅. Playbook: `anthology-portao-qualidade`.

## Comandos (scripts npm, criados no M0)

| comando | o que faz |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome (lint e formato) |
| `npm run deps` | dependency-cruiser (fronteiras) |
| `npm run dup` | jscpd (duplicação em `src/`) |
| `npm test` | Jest: unitário e mock |
| `npm run test:contract` | contrato com o SDK `openai` (Node; Python em venv) |
| `npm run mutation` | Stryker no núcleo puro |
| `npm run test:smoke` | smoke real contra o OpenRouter (precisa de `OPENROUTER_API_KEY`) |
| `python -I .claude/skills/anthology-docs/scripts/check_docs.py docs` | links e rastreabilidade de `docs/` (já existe) |

## Mapa do código (alvo do M0)

```text
src/
├── config/             carga e validação do anthology.config.json (SPEC-002)
├── auth/               guard de chave do gateway (SPEC-007)
├── openai-compat/      controllers, pipe zod, SSE writer (SPEC-001, SPEC-006)
│   └── translate/      funções puras OpenAI ↔ AI SDK (SPEC-005)
├── routing/            Rota → candidatos, Capacidade, merge, fallback (SPEC-003)
│   └── orchestrator/   escolha da Rota com `auto` (SPEC-009)
├── providers/          ProviderFactory, registry, ModelCatalog (SPEC-004)
│   └── openrouter/     único lugar que importa @openrouter/ai-sdk-provider
└── health/             /health, /ready, logging (SPEC-008)
test/
├── contract/           SDK openai (Node) + python/ (venv)
└── smoke/              provedor real
```

## Playbooks por tarefa

| tarefa | playbook em `.claude/skills/` |
|---|---|
| qualquer implementação ou correção | `anthology-tdd` → `anthology-testes` |
| endpoint, tradução, tool calling, SSE, erro | `anthology-contrato-openai` |
| chamada ao AI SDK ou upgrade dele | `anthology-ai-sdk` |
| provedor novo ou alterado | `anthology-provedor` |
| config: Rotas, Modelos, orquestrador, schema | `anthology-config` |
| estrutura, abstração, duplicação, refatoração | `anthology-design` |
| como escrever o código (TS, Nest, erros, nomes) | `anthology-padroes-codigo` |
| antes de commit e PR | `anthology-portao-qualidade` |
| specs, ADRs, PRD | `anthology-docs` |

## Convenções

- **Idioma:** documentação e conversa em português do Brasil; código, identificadores e mensagens
  de log em inglês. Os termos do glossário do PRD têm mapa fixo para o código (Rota → `Route`,
  Capacidade → `Capability`…), em `anthology-padroes-codigo`.
- **Commits:** Conventional Commits com o escopo do módulo (`feat(routing): …`). Revert-check,
  mutação e medições vão no corpo.
- **Git:** nunca commite na branch padrão; crie uma branch por tarefa.
- **Dependências:** versão exata (sem `^`/`~`) para `ai`, `@ai-sdk/*`, `@openrouter/*` e as
  ferramentas do portão.
