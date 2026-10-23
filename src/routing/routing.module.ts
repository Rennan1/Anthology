import { Global, Module } from "@nestjs/common";
import { CHAT_ROUTER, ROUTE_CATALOG } from "./gateway.types.js";
import { RoutingService } from "./routing.service.js";
import { LoggerRoutingRecorder, ROUTING_RECORDER } from "./routing-recorder.js";

/** Needs GATEWAY_CONFIG (ConfigModule) and MODEL_CATALOG (ProvidersModule, SPEC-004). */
@Global()
@Module({
  providers: [
    RoutingService,
    { provide: CHAT_ROUTER, useExisting: RoutingService },
    { provide: ROUTE_CATALOG, useExisting: RoutingService },
    { provide: ROUTING_RECORDER, useClass: LoggerRoutingRecorder },
  ],
  exports: [CHAT_ROUTER, ROUTE_CATALOG],
})
export class RoutingModule {}
