import { AUTO_MODEL_ID } from "../routing/gateway.types.js";
import type { ConfigIssue } from "./config-error.js";
import type { ConfigFile } from "./config-schema.js";
import { formatJsonPath } from "./json-path.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SECRET_LIKE = [/^sk-/, /^Bearer /, /[A-Za-z0-9+/]{32,}/];
export const SUPPORTED_VERSION = 1;

type Report = (path: readonly PropertyKey[], message: string) => void;

function checkIds(config: ConfigFile, report: Report): void {
  const check = (path: readonly PropertyKey[], id: string) => {
    if (ID_PATTERN.test(id)) return;
    report(path, `id '${id}' must match ${ID_PATTERN} (':' is reserved by the provider registry)`);
  };
  for (const section of ["providers", "models", "routes"] as const) {
    for (const id of Object.keys(config[section])) check([section, id], id);
  }
  config.auth.keys.forEach((key, i) => {
    check(["auth", "keys", i, "id"], key.id);
  });
}

function checkChain(
  path: readonly PropertyKey[],
  chain: readonly string[],
  models: ConfigFile["models"],
  report: Report,
): void {
  const seen = new Set<string>();
  chain.forEach((modelKey, i) => {
    if (!(modelKey in models)) report([...path, i], `unknown model '${modelKey}'`);
    else if (seen.has(modelKey)) {
      report([...path, i], `model '${modelKey}' is repeated in the chain`);
    }
    seen.add(modelKey);
  });
}

function checkReferences(
  config: ConfigFile,
  providerTypes: readonly string[],
  report: Report,
): void {
  for (const [id, provider] of Object.entries(config.providers)) {
    if (!providerTypes.includes(provider.type)) {
      report(
        ["providers", id, "type"],
        `no factory registered for provider type '${provider.type}'`,
      );
    }
  }
  for (const [id, model] of Object.entries(config.models)) {
    if (!(model.provider in config.providers)) {
      report(["models", id, "provider"], `unknown provider '${model.provider}'`);
    }
  }
  for (const [id, route] of Object.entries(config.routes)) {
    if (!(route.target in config.models)) {
      report(["routes", id, "target"], `unknown model '${route.target}'`);
    }
    const targetAt = route.fallbacks.indexOf(route.target);
    if (targetAt >= 0) {
      report(
        ["routes", id, "fallbacks", targetAt],
        `target '${route.target}' must not appear in fallbacks`,
      );
    }
    checkChain(["routes", id, "fallbacks"], route.fallbacks, config.models, report);
  }
}

function checkGatewayKeys(config: ConfigFile, report: Report): void {
  const { keys } = config.auth;
  if (keys.length === 0) report(["auth", "keys"], "at least one gateway key is required");
  const ids = new Set<string>();
  const envs = new Set<string>();
  keys.forEach((key, i) => {
    if (ids.has(key.id)) report(["auth", "keys", i, "id"], `duplicate key id '${key.id}'`);
    if (envs.has(key.keyEnv)) {
      report(["auth", "keys", i, "keyEnv"], `duplicate keyEnv '${key.keyEnv}'`);
    }
    ids.add(key.id);
    envs.add(key.keyEnv);
    key.routes.forEach((route, r) => {
      if (route !== "*" && !(route in config.routes)) {
        report(["auth", "keys", i, "routes", r], `unknown route '${route}'`);
      }
    });
  });
}

function checkSecretLike(path: readonly PropertyKey[], value: unknown, report: Report): void {
  if (typeof value === "string") {
    if (SECRET_LIKE.some((pattern) => pattern.test(value))) {
      report(
        path,
        "value looks like a secret; keep it in an environment variable and reference it with a *Env field",
      );
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => {
      checkSecretLike([...path, i], item, report);
    });
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) checkSecretLike([...path, key], item, report);
  }
}

function checkSecrets(config: ConfigFile, report: Report): void {
  for (const [id, provider] of Object.entries(config.providers)) {
    checkSecretLike(["providers", id, "headers"], provider.headers, report);
  }
  for (const [id, model] of Object.entries(config.models)) {
    checkSecretLike(["models", id, "providerOptions"], model.providerOptions, report);
  }
}

function checkOrchestrator(config: ConfigFile, report: Report): void {
  const { orchestrator, models, routes } = config;
  const check = (path: readonly PropertyKey[], modelKey: string) => {
    const model = models[modelKey];
    if (model === undefined) report(path, `unknown model '${modelKey}'`);
    else if (!model.capabilities.includes("json_schema")) {
      report(path, `model '${modelKey}' needs the json_schema capability to orchestrate`);
    }
  };
  check(["orchestrator", "model"], orchestrator.model);
  orchestrator.fallbacks.forEach((modelKey, i) => {
    check(["orchestrator", "fallbacks", i], modelKey);
  });
  if (!(orchestrator.defaultRoute in routes)) {
    report(["orchestrator", "defaultRoute"], `unknown route '${orchestrator.defaultRoute}'`);
  }
}

/** The cross-field rules of SPEC-002 that the schema cannot express. Collects all of them. */
export function checkIntegrity(
  config: ConfigFile,
  providerTypes: readonly string[],
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const report: Report = (path, message) => issues.push({ path: formatJsonPath(path), message });

  if (config.version !== SUPPORTED_VERSION) {
    report(
      ["version"],
      `unsupported version ${config.version}; only ${SUPPORTED_VERSION} is supported`,
    );
  }
  checkIds(config, report);
  checkReferences(config, providerTypes, report);
  checkGatewayKeys(config, report);
  checkSecrets(config, report);
  if (AUTO_MODEL_ID in config.routes) {
    report(
      ["routes", AUTO_MODEL_ID],
      `'${AUTO_MODEL_ID}' is a reserved id and cannot name a route`,
    );
  }
  checkOrchestrator(config, report);
  return issues;
}
