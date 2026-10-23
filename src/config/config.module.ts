import { type DynamicModule, Global, Module } from "@nestjs/common";
import type { GatewayConfig } from "./gateway-config.js";
import { loadConfig } from "./load-config.js";

export const GATEWAY_CONFIG = Symbol("GATEWAY_CONFIG");

export interface ConfigModuleOptions {
  /** Provider types with a registered factory (SPEC-004); the app composes it from the registry. */
  readonly providerTypes: readonly string[];
  readonly path?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Loads the config once at boot; a ConfigError here aborts the process (SPEC-002). */
@Global()
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules are declared as a static forRoot
export class ConfigModule {
  static forRoot(options: ConfigModuleOptions): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        {
          provide: GATEWAY_CONFIG,
          useFactory: (): GatewayConfig =>
            loadConfig({
              env: options.env ?? process.env,
              providerTypes: options.providerTypes,
              ...(options.path !== undefined && { path: options.path }),
            }),
        },
      ],
      exports: [GATEWAY_CONFIG],
    };
  }
}
