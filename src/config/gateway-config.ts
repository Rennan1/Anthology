import type { ConfigFile } from "./config-schema.js";

type ConfigProvider = ConfigFile["providers"][string];
type ConfigAuthKey = ConfigFile["auth"]["keys"][number];

/** `*Env` references resolved against the environment at boot (SPEC-002). */
export type ResolvedProvider = ConfigProvider & { readonly apiKey: string };
export type ResolvedAuthKey = ConfigAuthKey & { readonly key: string };

/** Immutable runtime config (deep-frozen); the only way to change it is a restart. */
export type GatewayConfig = Readonly<
  Omit<ConfigFile, "providers" | "auth"> & {
    providers: Readonly<Record<string, ResolvedProvider>>;
    auth: Readonly<{ keys: readonly ResolvedAuthKey[] }>;
  }
>;

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
