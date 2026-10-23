import { describe, expect, it } from "@jest/globals";
import type { GatewayResult } from "../../routing/gateway.types.js";
import { buildGatewayHeaders } from "./gateway-headers.js";

const result: GatewayResult = {
  text: "hi",
  toolCalls: [],
  finishReason: "stop",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  route: "code",
  routedBy: "orchestrator",
  modelKey: "claude-sonnet",
  attempts: 2,
};

describe("buildGatewayHeaders", () => {
  it("exposes route, routed-by, serving model and attempts as strings", () => {
    expect(buildGatewayHeaders(result)).toEqual({
      "x-anthology-route": "code",
      "x-anthology-routed-by": "orchestrator",
      "x-anthology-model": "claude-sonnet",
      "x-anthology-attempts": "2",
    });
  });

  it("does not emit x-request-id (owned by the controller middleware)", () => {
    expect(buildGatewayHeaders(result)).not.toHaveProperty("x-request-id");
  });
});
