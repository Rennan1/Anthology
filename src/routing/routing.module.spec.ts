import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { mockCatalog } from "../../test/support/catalog.js";
import { testConfig } from "../../test/support/config-fixture.js";
import { scriptedModel, textReply } from "../../test/support/scripted-model.js";
import { GATEWAY_CONFIG } from "../config/config.module.js";
import { MODEL_CATALOG } from "../providers/model-catalog.js";
import { CHAT_ROUTER, type ChatRouter, ROUTE_CATALOG, type RouteCatalog } from "./gateway.types.js";
import { RoutingModule } from "./routing.module.js";

describe("RoutingModule", () => {
  it("exposes the router and the route catalog ports, wired from config and catalog", async () => {
    const config = testConfig();
    const catalog = mockCatalog(config, {
      sonnet: scriptedModel(),
      flash: scriptedModel(textReply("via módulo")),
      mini: scriptedModel(),
    });
    // Stand-ins for the global ConfigModule and the ProvidersModule (SPEC-004).
    @Global()
    @Module({
      providers: [
        { provide: GATEWAY_CONFIG, useValue: config },
        { provide: MODEL_CATALOG, useValue: catalog },
      ],
      exports: [GATEWAY_CONFIG, MODEL_CATALOG],
    })
    class StandInModule {}
    const moduleRef = await Test.createTestingModule({
      imports: [StandInModule, RoutingModule],
    }).compile();
    const router = moduleRef.get<ChatRouter>(CHAT_ROUTER);
    const routes = moduleRef.get<RouteCatalog>(ROUTE_CATALOG);

    const result = await router.complete(
      {
        model: "summarize",
        continuationRoute: undefined,
        messages: [{ role: "user", content: "oi" }],
        params: {},
        tools: undefined,
        toolChoice: undefined,
        parallelToolCalls: undefined,
        responseFormat: undefined,
        endUser: undefined,
      },
      { keyId: "app-chatbot" },
      new AbortController().signal,
    );

    expect(result.text).toBe("via módulo");
    expect(routes.visibleRouteIds({ keyId: "app-chatbot" })).toEqual(["summarize", "general"]);
  });
});
