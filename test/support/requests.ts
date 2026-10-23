import { jsonSchema, type ModelMessage, type ToolSet, tool } from "ai";
import type { GatewayRequest } from "../../src/routing/gateway.types.js";

export const baseRequest: GatewayRequest = {
  model: "code",
  continuationRoute: undefined,
  messages: [{ role: "user", content: [{ type: "text", text: "oi" }] }],
  params: {},
  tools: undefined,
  toolChoice: undefined,
  parallelToolCalls: undefined,
  responseFormat: undefined,
  endUser: undefined,
};

export const weatherTools: ToolSet = {
  get_weather: tool({
    description: "Clima atual",
    inputSchema: jsonSchema({ type: "object", properties: { city: { type: "string" } } }),
  }),
};

export const imageMessage: ModelMessage = {
  role: "user",
  content: [{ type: "image", image: new URL("https://exemplo.test/gato.png") }],
};
