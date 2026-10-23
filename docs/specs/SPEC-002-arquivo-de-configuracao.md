---
id: SPEC-002
titulo: Arquivo de configuração
status: rascunho
adrs: [ADR-0005, ADR-0006, ADR-0004]
requisitos: [RF-09, RF-13, RNF-03, RNF-06]
---

# SPEC-002 — Arquivo de configuração

## Objetivo

Definir o formato, a validação e o carregamento de `anthology.config.json`, a única fonte de
configuração funcional do gateway ([ADR-0005](../adrs/0005-configuracao-declarativa-em-json.md)).

## Carregamento

1. Caminho: `ANTHOLOGY_CONFIG_PATH`, ou `./anthology.config.json` se ausente.
2. Lê, faz parse e valida contra o schema zod. Depois roda as validações de integridade (abaixo).
3. Resolve cada referência `*Env` contra `process.env`. Variável ausente ou vazia **aborta o boot**.
4. O resultado é um `GatewayConfig` imutável (`Object.freeze` profundo), injetado pelo
   `ConfigModule`.
5. Qualquer falha encerra o processo com código ≠ 0. A mensagem lista **todos** os erros, cada um
   com o caminho JSON (`routes.code.fallbacks[1]`), não só o primeiro.

O arquivo é lido só no boot; não há hot reload na v1.

## Estrutura

```jsonc
{
  "$schema": "./anthology.config.schema.json",
  "version": 1,

  "server": {
    "port": 8080,
    "bodyLimit": "10mb",
    "shutdownGraceMs": 30000
  },

  "logging": {
    "level": "info",
    "includeContent": false
  },

  "auth": {
    "keys": [
      { "id": "app-backoffice", "keyEnv": "ANTHOLOGY_KEY_BACKOFFICE", "routes": ["*"] },
      { "id": "app-chatbot",    "keyEnv": "ANTHOLOGY_KEY_CHATBOT",    "routes": ["general", "summarize"] }
    ]
  },

  "providers": {
    "openrouter": {
      "type": "openrouter",
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "baseURL": "https://openrouter.ai/api/v1",
      "headers": { "HTTP-Referer": "https://anthology.interno", "X-Title": "Anthology" }
    }
  },

  "models": {
    "sonnet": {
      "provider": "openrouter",
      "modelId": "anthropic/claude-sonnet-4.5",
      "capabilities": ["tools", "vision", "json_schema"],
      "contextWindow": 200000,
      "maxOutputTokens": 16000,
      "timeoutMs": 120000,
      "maxRetries": 1,
      "defaults": { "temperature": 0.2 },
      "providerOptions": {}
    },
    "flash": {
      "provider": "openrouter",
      "modelId": "google/gemini-2.5-flash",
      "capabilities": ["tools", "vision", "json_schema"],
      "timeoutMs": 60000
    },
    "mini": {
      "provider": "openrouter",
      "modelId": "openai/gpt-5-mini",
      "capabilities": ["tools", "json_schema"]
    }
  },

  "orchestrator": {
    "model": "flash",
    "fallbacks": ["mini"],
    "defaultRoute": "general",
    "timeoutMs": 5000,
    "instructions": "Na dúvida entre duas Rotas, prefira a de menor custo.",
    "context": { "maxMessages": 6, "maxCharsPerMessage": 2000, "maxChars": 8000 }
  },

  "routes": {
    "code": {
      "description": "Escrever, revisar, depurar ou explicar código e SQL",
      "target": "sonnet", "fallbacks": ["mini"]
    },
    "summarize": {
      "description": "Resumir ou condensar textos longos e documentos",
      "target": "flash", "fallbacks": ["mini"],
      "defaults": { "temperature": 0 }
    },
    "general": {
      "description": "Conversa geral e qualquer tarefa que não se encaixe nas outras Rotas",
      "target": "mini", "fallbacks": ["flash"],
      "enforce": { "maxOutputTokens": 4000 }
    }
  }
}
```

Os ids de modelo upstream acima são **exemplos**. A curadoria real é decisão do time, revisada em PR.

## Campos

### `providers.<id>`

| campo | tipo | obrigatório | descrição |
|---|---|---|---|
| `type` | string | sim | qual fábrica usar ([SPEC-004](SPEC-004-camada-de-provedores.md)); na v1 só `openrouter` é oficial |
| `apiKeyEnv` | string | sim | **nome** da variável de ambiente com a chave |
| `baseURL` | string (URL https) | não | sobrescreve o padrão da fábrica |
| `headers` | objeto string→string | não | headers fixos enviados ao provedor; **não** aceita segredo |
| `options` | objeto | não | opções extras da fábrica, validadas pelo schema da própria fábrica |

### `models.<id>`

| campo | tipo | obrigatório | descrição |
|---|---|---|---|
| `provider` | string | sim | chave em `providers` |
| `modelId` | string | sim | id do modelo no provedor |
| `capabilities` | array de `tools` \| `vision` \| `json_schema` | sim (pode ser `[]`) | Capacidades declaradas; usadas no filtro da [SPEC-003](SPEC-003-roteamento-e-fallback.md) |
| `contextWindow` | inteiro | não | só informativo na v1 (log, `/v1/models` futuro) |
| `maxOutputTokens` | inteiro | não | teto; o valor pedido é limitado a ele |
| `timeoutMs` | inteiro | não (padrão 120000) | timeout por tentativa |
| `maxRetries` | inteiro 0–3 | não (padrão 1) | retries do próprio AI SDK no mesmo modelo antes do fallback |
| `defaults` | `Params` | não | parâmetros padrão do modelo |
| `providerOptions` | objeto | não | repassado em `providerOptions[<namespace da fábrica>]` |

### `routes.<id>`

| campo | tipo | obrigatório | descrição |
|---|---|---|---|
| `description` | string (≤ 300 chars) | sim | **lida pelo orquestrador** para escolher a Rota ([SPEC-009](SPEC-009-orquestrador.md)); escreva como critério de escolha ("quando usar"), não como nome |
| `target` | string | sim | chave em `models` |
| `fallbacks` | array de string | não (padrão `[]`) | chaves em `models`, em ordem |
| `defaults` | `Params` | não | sobrepõe `models.<id>.defaults` |
| `enforce` | `Params` | não | sobrepõe **até a requisição** (ex.: teto de tokens da Rota) |

`Params` é um objeto com `temperature`, `topP`, `maxOutputTokens`, `presencePenalty`,
`frequencyPenalty`, `seed` e `stop`, nos nomes do AI SDK.

### `orchestrator` (obrigatório)

Configura a LLM que escolhe a Rota em requisições `model: "auto"` ([SPEC-009](SPEC-009-orquestrador.md)).

| campo | tipo | obrigatório | descrição |
|---|---|---|---|
| `model` | string | sim | chave em `models`; precisa ter a Capacidade `json_schema` |
| `fallbacks` | array de string | não (padrão `[]`) | chaves em `models`, também com `json_schema` |
| `defaultRoute` | string | sim | Rota usada quando o orquestrador falha |
| `timeoutMs` | inteiro | não (padrão 5000) | timeout por candidato do orquestrador |
| `instructions` | string (≤ 2000 chars) | não | critério extra, anexado ao prompt de sistema do orquestrador |
| `context.maxMessages` | inteiro | não (padrão 6) | ver o recorte na SPEC-009 |
| `context.maxCharsPerMessage` | inteiro | não (padrão 2000) | idem |
| `context.maxChars` | inteiro | não (padrão 8000) | idem |

O modelo do orquestrador é um Modelo comum de `models`. Ele pode ser também alvo de alguma Rota.

### `auth.keys[]`

| campo | tipo | obrigatório | descrição |
|---|---|---|---|
| `id` | string | sim | nome da chave no log; nunca o valor |
| `keyEnv` | string | sim | **nome** da variável de ambiente com o valor da chave |
| `routes` | array de string | sim | ids de Rota permitidos; `["*"]` libera todas |

## Validações de integridade

Além do schema, o loader verifica:

1. Todo id (provedor, modelo, Rota, chave) casa `^[a-z0-9][a-z0-9._-]{0,63}$`. Não aceita `:`,
   que é o separador do registry do AI SDK.
2. `models.*.provider` existe em `providers`. `providers.*.type` tem fábrica registrada.
3. `routes.*.target` e cada item de `fallbacks` existem em `models`. Não há repetição dentro de uma
   cadeia, e o `target` não aparece em `fallbacks`.
4. `auth.keys[].routes` só referencia Rotas existentes (ou `"*"`). `id` e `keyEnv` são únicos.
5. `auth.keys` tem pelo menos uma chave. Não existe modo sem autenticação.
6. Nenhum valor de `headers` ou `providerOptions` tem cara de segredo: o loader rejeita string que
   comece com `sk-`, `Bearer ` ou tenha 32+ caracteres base64/hex contínuos, com mensagem que manda
   usar `*Env`. É uma heurística e não substitui o scanner de segredo do CI.
7. `version` é `1`.
8. `auto` é id **reservado**: nenhuma Rota pode se chamar `auto`.
9. `orchestrator.model` e cada item de `orchestrator.fallbacks` existem em `models` e têm a
   Capacidade `json_schema`. `orchestrator.defaultRoute` existe em `routes`.

## Artefatos no repositório

- `anthology.config.example.json`: o exemplo acima, válido, versionado.
- `anthology.config.schema.json`: JSON Schema **gerado** do schema zod por script de build, para
  autocompletar no editor. O CI falha se o arquivo gerado divergir do commitado.
- `.env.example` com os nomes de todas as variáveis `*Env` do exemplo, sem valores.

## Critérios de aceite

1. O boot com `anthology.config.example.json` e as variáveis do `.env.example` preenchidas sobe e
   responde `/ready` com 200.
2. Para cada validação de integridade (1–9) existe um fixture inválido. Cada um derruba o boot com
   código ≠ 0, e a mensagem contém o caminho JSON do campo.
3. Um fixture com **dois** erros reporta os dois.
4. Variável referenciada por `apiKeyEnv` ausente derruba o boot, e a mensagem cita o *nome* da
   variável, nunca um valor.
5. Mutar o `GatewayConfig` em tempo de execução lança erro (o objeto está congelado).

## Notas de implementação

- O schema é **estrito**: campo desconhecido no arquivo é erro (typo em `fallbacks` não passa em
  silêncio). A única exceção é `$schema`.
- Erros de schema (tipo, faixa, campo desconhecido) são reportados juntos, e as validações de
  integridade e de `*Env` só rodam sobre um arquivo que passou no schema. Todas as de integridade e
  de `*Env` são reportadas juntas.
- `loadConfig` recebe a lista de tipos de provedor com fábrica registrada
  ([SPEC-004](SPEC-004-camada-de-provedores.md)); o `ConfigModule.forRoot` a recebe do app.
- O `GatewayConfig` guarda o valor resolvido de cada `*Env` (`providers.<id>.apiKey`,
  `auth.keys[].key`) ao lado do nome. O redator de log da SPEC-008 cobre campos `*key*`.
- O JSON Schema gerado fica em `anthology.config.schema.json`; `npm run schema:generate` o regera, e
  um teste unitário falha se ele divergir do schema zod.

## Fora de escopo (v1)

Hot reload, configuração vinda de banco ou API, múltiplos arquivos, herança entre Rotas.
