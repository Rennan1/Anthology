import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  AUTO_MODEL_ID,
  type GatewayCaller,
  ROUTE_CATALOG,
  type RouteCatalog,
} from "../routing/gateway.types.js";
import { GatewayError } from "../routing/gateway-error.js";
import { Caller } from "./gateway-caller.decorator.js";
import { buildModel, buildModelList } from "./response/build-model-list.js";

@Controller("v1/models")
export class ModelsController {
  /** `created` dos modelos é o instante do boot (SPEC-001). */
  private readonly bootedAt = Math.floor(Date.now() / 1000);

  constructor(@Inject(ROUTE_CATALOG) private readonly catalog: RouteCatalog) {}

  @Get()
  list(@Caller() caller: GatewayCaller) {
    return buildModelList(this.catalog.visibleRouteIds(caller), this.bootedAt);
  }

  @Get(":id")
  retrieve(@Param("id") id: string, @Caller() caller: GatewayCaller) {
    // Rota inexistente e Rota não visível à chave dão o mesmo 404 (não revelar que existe).
    if (id !== AUTO_MODEL_ID && !this.catalog.visibleRouteIds(caller).includes(id)) {
      throw new GatewayError("model_not_found", `The model '${id}' does not exist.`, {
        param: "model",
      });
    }
    return buildModel(id, this.bootedAt);
  }
}
