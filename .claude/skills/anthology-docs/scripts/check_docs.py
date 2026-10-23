#!/usr/bin/env python3
"""Confere links, âncoras e a rastreabilidade PRD <-> specs <-> ADRs do docs/ do Anthology.

Uso: python -I check_docs.py [pasta-docs]    (padrão: ./docs)
Saída: 0 sem problemas, 1 com problemas (listados), 2 se a pasta não tem PRD.md.
"""

import re
import sys
from pathlib import Path

LINK = re.compile(r"\]\(([^)#\s]+\.md)(?:#([^)\s]+))?\)")
HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.MULTILINE)
FRONTMATTER = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
ADR_FILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
SPEC_FILE = re.compile(r"^(SPEC-\d{3})-[a-z0-9-]+\.md$")
ADR_STATUS = re.compile(r"^(proposto|aceito|deprecado|substituído por ADR-\d{4})$")
REQ_ROW = re.compile(r"^\| (RN?F-\d+) \|", re.MULTILINE)


def frontmatter(text: str) -> dict[str, str]:
    m = FRONTMATTER.match(text)
    if not m:
        return {}
    pares = (linha.split(":", 1) for linha in m.group(1).splitlines() if ":" in linha)
    return {k.strip(): v.strip() for k, v in pares}


def lista(valor: str) -> set[str]:
    return {x.strip() for x in valor.strip("[]").split(",") if x.strip()}


def slug(titulo: str) -> str:
    # Mesmo algoritmo de âncora do GitHub: minúsculas, sem pontuação, espaço vira hífen.
    s = re.sub(r"[^\w\s-]", "", titulo.strip().lower())
    return re.sub(r"\s", "-", s)


def checar_links(docs: Path, arquivos: list[Path]) -> tuple[int, list[str]]:
    total, problemas = 0, []
    for arq in arquivos:
        for m in LINK.finditer(arq.read_text(encoding="utf-8")):
            total += 1
            alvo = (arq.parent / m.group(1)).resolve()
            onde = arq.relative_to(docs)
            if not alvo.exists():
                problemas.append(f"{onde}: link quebrado -> {m.group(1)}")
            elif m.group(2):
                ancoras = {slug(h) for h in HEADING.findall(alvo.read_text(encoding="utf-8"))}
                if m.group(2) not in ancoras:
                    problemas.append(f"{onde}: âncora inexistente -> {m.group(1)}#{m.group(2)}")
    return total, problemas


def checar_adrs(docs: Path, prd: str) -> tuple[int, list[str]]:
    problemas, numeros = [], []
    adrs = sorted((docs / "adrs").glob("*.md"))
    for arq in adrs:
        m = ADR_FILE.match(arq.name)
        if not m:
            problemas.append(f"adrs/{arq.name}: nome fora do padrão NNNN-slug.md")
            continue
        num = m.group(1)
        numeros.append(int(num))
        texto = arq.read_text(encoding="utf-8")
        status = frontmatter(texto).get("status", "")
        if not ADR_STATUS.match(status):
            problemas.append(f"adrs/{arq.name}: status inválido '{status}'")
        if not re.search(rf"^# ADR-{num} ", texto, re.MULTILINE):
            problemas.append(f"adrs/{arq.name}: título não começa com '# ADR-{num} '")
        # Só a linha do índice de ADRs começa com o link do próprio ADR; as tabelas de requisitos
        # também linkam ADRs, mas na última coluna.
        linha = next((l for l in prd.splitlines() if l.startswith(f"| [{num}](adrs/{arq.name})")), None)
        if linha is None:
            problemas.append(f"adrs/{arq.name}: ausente do índice de ADRs do PRD")
        elif linha.rstrip(" |").rsplit("|", 1)[-1].strip(" *") != status:
            problemas.append(f"adrs/{arq.name}: status no PRD difere do frontmatter ('{status}')")
    if numeros != list(range(1, len(numeros) + 1)):
        problemas.append(f"adrs/: numeração com buraco ou repetição {numeros}")
    return len(adrs), problemas


def checar_specs(docs: Path, prd: str) -> tuple[int, list[str]]:
    problemas = []
    linhas_req = [l for l in prd.splitlines() if REQ_ROW.match(l)]
    reqs_prd = {REQ_ROW.match(l).group(1) for l in linhas_req}
    citados = set()
    specs = sorted((docs / "specs").glob("*.md"))
    for arq in specs:
        m = SPEC_FILE.match(arq.name)
        if not m:
            problemas.append(f"specs/{arq.name}: nome fora do padrão SPEC-NNN-slug.md")
            continue
        sid = m.group(1)
        fm = frontmatter(arq.read_text(encoding="utf-8"))
        if fm.get("id") != sid:
            problemas.append(f"specs/{arq.name}: id do frontmatter '{fm.get('id')}' != {sid}")
        if f"(specs/{arq.name})" not in prd:
            problemas.append(f"specs/{arq.name}: ausente do PRD")
        declarados = lista(fm.get("requisitos", ""))
        no_prd = {REQ_ROW.match(l).group(1) for l in linhas_req if sid in l}
        citados |= declarados
        for r in sorted(declarados - reqs_prd):
            problemas.append(f"specs/{arq.name}: requisito {r} não existe no PRD")
        if declarados != no_prd:
            problemas.append(
                f"specs/{arq.name}: frontmatter {sorted(declarados)} != linhas do PRD que a citam {sorted(no_prd)}"
            )
    for r in sorted(reqs_prd - citados):
        problemas.append(f"PRD.md: requisito {r} não é declarado por nenhuma spec")
    return len(specs), problemas


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    docs = Path(sys.argv[1] if len(sys.argv) > 1 else "docs").resolve()
    if not (docs / "PRD.md").is_file():
        print(f"erro: {docs} não tem PRD.md")
        return 2
    prd = (docs / "PRD.md").read_text(encoding="utf-8")
    arquivos = sorted(docs.rglob("*.md"))

    n_links, p_links = checar_links(docs, arquivos)
    n_adrs, p_adrs = checar_adrs(docs, prd)
    n_specs, p_specs = checar_specs(docs, prd)
    n_reqs = len(REQ_ROW.findall(prd))
    problemas = p_links + p_adrs + p_specs

    print(f"arquivos: {len(arquivos)} | links: {n_links} | ADRs: {n_adrs} | specs: {n_specs} | requisitos: {n_reqs}")
    if n_links == 0 or n_adrs == 0 or n_specs == 0 or n_reqs == 0:
        problemas.append("denominador zero: algo não foi encontrado; confira a pasta passada")
    for p in problemas:
        print(f"  - {p}")
    print(f"problemas: {len(problemas)}")
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
