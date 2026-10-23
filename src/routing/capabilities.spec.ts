import { baseRequest, imageMessage, weatherTools } from "../../test/support/requests.js";
import { missingCapabilities, requiredCapabilities } from "./capabilities.js";

describe("requiredCapabilities (SPEC-003 table)", () => {
  it("needs nothing for plain text", () => {
    expect(requiredCapabilities(baseRequest)).toEqual([]);
  });

  it("needs tools when there is at least one tool, not for an empty tool set", () => {
    expect(requiredCapabilities({ ...baseRequest, tools: weatherTools })).toEqual(["tools"]);
    expect(requiredCapabilities({ ...baseRequest, tools: {} })).toEqual([]);
  });

  it("needs vision for an image part in any message", () => {
    const messages = [
      { role: "user" as const, content: "oi" },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "olá" }] },
      imageMessage,
    ];

    expect(requiredCapabilities({ ...baseRequest, messages })).toEqual(["vision"]);
  });

  it("needs vision for a file part whose media type is an image", () => {
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "file" as const, data: "AAAA", mediaType: "image/png" }],
      },
    ];

    expect(requiredCapabilities({ ...baseRequest, messages })).toEqual(["vision"]);
  });

  it("does not need vision for text parts or string content", () => {
    expect(requiredCapabilities(baseRequest)).toEqual([]);
    expect(
      requiredCapabilities({ ...baseRequest, messages: [{ role: "user", content: "oi" }] }),
    ).toEqual([]);
  });

  it("needs json_schema for json_schema, not for json_object", () => {
    const schema = { type: "json_schema" as const, name: "r", schema: {} };

    expect(requiredCapabilities({ ...baseRequest, responseFormat: schema })).toEqual([
      "json_schema",
    ]);
    expect(
      requiredCapabilities({ ...baseRequest, responseFormat: { type: "json_object" } }),
    ).toEqual([]);
  });

  it("combines requirements in a stable order", () => {
    const request = {
      ...baseRequest,
      tools: weatherTools,
      messages: [imageMessage],
      responseFormat: { type: "json_schema" as const, name: "r", schema: {} },
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
