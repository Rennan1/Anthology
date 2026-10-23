@AGENTS.md

## Específico do Claude Code

- **Skills do projeto:** os playbooks da tabela acima estão em `.claude/skills/` e são carregados
  pela descrição. Invoque pela ferramenta Skill quando a tarefa casar, em vez de ler o `SKILL.md`
  na mão. Em implementação, `anthology-tdd` vem antes da primeira linha de código de produção.
- **Hooks do time que agem aqui:**
  - `lint-on-edit` roda o Biome em cada arquivo editado. Ele precisa do `@biomejs/biome`
    instalado; sem ele, avisa e não verifica nada.
  - `typecheck-on-stop` só cobre Python, então o `npm run typecheck` deste projeto é sua
    responsabilidade.
  - `branch-guard` recusa commit na branch padrão.
  - `pr-gate` exige os três gates antes de abrir PR.
- **Docs:** depois de editar qualquer coisa em `docs/`, rode o `check_docs.py`. Ele sai 1 quando
  há link quebrado ou rastreabilidade divergente.
- **Subagentes:** quem dispara passa no prompt o teto de ambiente (só venv/nvm + docker) e a
  spec/critério de aceite em jogo. O subagente não tem este contexto.
