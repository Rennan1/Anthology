import { missingCapabilities, requiredCapabilities } from "./capabilities.js";
import type { GatewayRequest } from "./gateway.types.js";

const base: GatewayRequest = {
  model: "code",
  continuationRoute: undefined,
  messages: [{ role: "user", content: "oi" }],
  params: {},
  tools: undefined,
  toolChoice: undefined,
  parallelToolCalls: undefined,
  responseFormat: undefined,
  endUser: undefined,
};

describe("requiredCapabilities (SPEC-003 table)", () => {
  it("needs nothing for plain text", () => {
    expect(requiredCapabilities(base)).toEqual([]);
  });

  it("needs tools when tools is not empty, not when it is an empty list", () => {
    expect(requiredCapabilities({ ...base, tools: [{ type: "function" }] })).toEqual(["tools"]);
    expect(requiredCapabilities({ ...base, tools: [] })).toEqual([]);
  });

  it("needs vision for an image part in any message", () => {
    const messages = [
      { role: "user", content: "oi" },
      { role: "assistant", content: "olá" },
      {
        role: "user",
        content: [
          { type: "text", text: "veja" },
          { type: "image", image: "x" },
        ],
      },
    ];

    expect(requiredCapabilities({ ...base, messages })).toEqual(["vision"]);
  });

  it("does not need vision for text parts or string content", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "veja" }] }];

    expect(requiredCapabilities({ ...base, messages })).toEqual([]);
  });

  it("needs json_schema for json_schema, not for json_object or text", () => {
    expect(requiredCapabilities({ ...base, responseFormat: { type: "json_schema" } })).toEqual([
      "json_schema",
    ]);
    expect(requiredCapabilities({ ...base, responseFormat: { type: "json_object" } })).toEqual([]);
    expect(requiredCapabilities({ ...base, responseFormat: { type: "text" } })).toEqual([]);
  });

  it("combines requirements in a stable order", () => {
    const request: GatewayRequest = {
      ...base,
      tools: [{}],
      messages: [{ role: "user", content: [{ type: "image", image: "x" }] }],
      responseFormat: { type: "json_schema" },
    };

    expect(requiredCapabilities(request)).toEqual(["tools", "vision", "json_schema"]);
  });
});

describe("missingCapabilities", () => {
  it("lists what the model lacks, in the order required", () => {
    expect(
      missingCapabilities({ capabilities: ["tools"] }, ["tools", "vision", "json_schema"]),
    ).toEqual(["vision", "json_schema"]);
  });

  it("is empty when the model is a superset", () => {
    expect(missingCapabilities({ capabilities: ["tools", "vision"] }, ["vision"])).toEqual([]);
  });
});
