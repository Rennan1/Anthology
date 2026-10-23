/** Fronteiras de módulo (ADR-0002/0003/0004). Afrouxar uma regra exige o porquê aqui e a aprovação do usuário. */
module.exports = {
  forbidden: [
    {
      name: "routing-nao-conhece-openai",
      severity: "error",
      from: { path: "^src/routing/" },
      to: { path: "^src/openai-compat/" },
    },
    {
      name: "providers-nao-conhecem-ninguem",
      severity: "error",
      from: { path: "^src/providers/" },
      to: { path: "^src/(routing|openai-compat)/" },
    },
    {
      name: "openai-compat-via-routing",
      severity: "error",
      from: { path: "^src/openai-compat/" },
      to: { path: "^src/providers/" },
    },
    {
      name: "openrouter-confinado",
      severity: "error",
      from: { pathNot: "^src/providers/openrouter/" },
      to: { path: "^node_modules/@openrouter/" },
    },
    {
      name: "ai-sdk-confinado",
      severity: "error",
      from: { pathNot: "^src/(providers|routing|openai-compat/translate)/" },
      to: { path: "^node_modules/ai/" },
    },
    { name: "sem-ciclos", severity: "error", from: {}, to: { circular: true } },
    {
      name: "teste-nao-vaza",
      severity: "error",
      from: { path: "^src/", pathNot: ".spec.ts$" },
      to: { path: "^test/" },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
