import { readFileSync } from "node:fs";
import { formatJsonPath } from "../common/json-path.js";
import { ConfigError, type ConfigIssue } from "./config-error.js";
import { checkIntegrity } from "./config-integrity.js";
import { type ConfigFile, ConfigFileSchema } from "./config-schema.js";
import { deepFreeze, type GatewayConfig } from "./gateway-config.js";

export interface ParseConfigOptions {
  readonly env: NodeJS.ProcessEnv;
  /** Provider types that have a registered factory (SPEC-004). */
  readonly providerTypes: readonly string[];
}

const DEFAULT_CONFIG_PATH = "./anthology.config.json";

/** Issues name the variable, never its value. */
function readEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  path: readonly PropertyKey[],
  issues: ConfigIssue[],
): string {
  const value = env[name];
  if (value === undefined || value === "") {
    issues.push({
      path: formatJsonPath(path),
      message: `environment variable ${name} is not set or is empty`,
    });
    return "";
  }
  return value;
}

function resolveEnv(
  file: ConfigFile,
  env: NodeJS.ProcessEnv,
  issues: ConfigIssue[],
): GatewayConfig {
  const providers = Object.fromEntries(
    Object.entries(file.providers).map(([id, provider]) => [
      id,
      {
        ...provider,
        apiKey: readEnv(env, provider.apiKeyEnv, ["providers", id, "apiKeyEnv"], issues),
      },
    ]),
  );
  const keys = file.auth.keys.map((key, i) => ({
    ...key,
    key: readEnv(env, key.keyEnv, ["auth", "keys", i, "keyEnv"], issues),
  }));
  return { ...file, providers, auth: { keys } };
}

export function parseConfig(raw: unknown, options: ParseConfigOptions): GatewayConfig {
  const parsed = ConfigFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => ({
        path: formatJsonPath(issue.path),
        message: issue.message,
      })),
    );
  }
  const issues = checkIntegrity(parsed.data, options.providerTypes);
  const config = resolveEnv(parsed.data, options.env, issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze(config);
}

/** Reads, validates and resolves the config file; any failure is a ConfigError (boot aborts). */
export function loadConfig(options: ParseConfigOptions & { path?: string }): GatewayConfig {
  const path = options.path ?? options.env.ANTHOLOGY_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new ConfigError([
      { path: "", message: `cannot read config file '${path}': ${String(cause)}` },
    ]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError([{ path: "", message: `config file '${path}' is not valid JSON` }]);
  }
  return parseConfig(raw, options);
}
