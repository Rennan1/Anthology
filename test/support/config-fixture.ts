import { readFileSync } from "node:fs";
import type { GatewayConfig } from "../../src/config/gateway-config.js";
import { parseConfig } from "../../src/config/load-config.js";

// biome-ignore lint/suspicious/noExplicitAny: fixture mutation helper, tests poke arbitrary paths
export type ConfigJson = Record<string, any>;

export const TEST_ENV = {
  OPENROUTER_API_KEY: "provider-key-sentinel",
  ANTHOLOGY_KEY_BACKOFFICE: "gateway-key-backoffice-sentinel",
  ANTHOLOGY_KEY_CHATBOT: "gateway-key-chatbot-sentinel",
};

/** The committed example with `maxRetries: 0` (the AI SDK would otherwise sleep 2 s between retries). */
export function testConfig(
  change?: (config: ConfigJson) => void,
  providerTypes: readonly string[] = ["openrouter"],
): GatewayConfig {
  const raw: ConfigJson = JSON.parse(readFileSync("anthology.config.example.json", "utf8"));
  for (const model of Object.values<ConfigJson>(raw.models)) model.maxRetries = 0;
  change?.(raw);
  return parseConfig(raw, { env: TEST_ENV, providerTypes });
}
