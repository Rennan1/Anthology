import { type DynamicModule, Global, Module } from "@nestjs/common";
import { GATEWAY_CONFIG } from "../config/config.module.js";
import type { GatewayConfig } from "../config/gateway-config.js";
import { buildModelCatalog } from "./build-model-catalog.js";
import { MODEL_CATALOG } from "./model-catalog.js";
import type { ProviderFactory } from "./provider-factory.js";

export interface ProvidersModuleOptions {
  /** Usually `providerFactories()`; the same list feeds `ConfigModule.forRoot({ providerTypes })`. */
  readonly factories: readonly ProviderFactory[];
}

/** Builds the providers, the registry and the ModelCatalog at boot; a bad model aborts it. */
@Global()
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules are declared as a static forRoot
export class ProvidersModule {
  static forRoot(options: ProvidersModuleOptions): DynamicModule {
    return {
      module: ProvidersModule,
      providers: [
        {
          provide: MODEL_CATALOG,
          inject: [GATEWAY_CONFIG],
          useFactory: (config: GatewayConfig) => buildModelCatalog(config, options.factories),
        },
      ],
      exports: [MODEL_CATALOG],
    };
  }
}
