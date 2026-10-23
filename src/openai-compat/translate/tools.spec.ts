import { asSchema } from "ai";
import { GatewayError } from "../../routing/gateway-error.js";
import { translateTools } from "./tools.js";

function errorOf(tools: unknown, toolChoice?: unknown): GatewayError {
  try {
    translateTools(tools, toolChoice);
  } catch (err) {
    if (err instanceof GatewayError) return err;
    throw err;
  }
  throw new Error("expected GatewayError");
}

const fn = (name: string, extra: Record<string, unknown> = {}) => ({
  type: "function",
  function: { name, ...extra },
});

describe("translateTools: tools", () => {
  it("builds one execute-less tool per function, keyed by name", () => {
    const parameters = { type: "object", properties: { cidade: { type: "string" } } };

    const { tools } = translateTools(
      [fn("clima", { description: "Clima atual", parameters })],
      undefined,
    );

    const clima = tools?.clima;
    expect(Object.keys(tools ?? {})).toEqual(["clima"]);
    expect(clima?.description).toBe("Clima atual");
    expect(clima?.execute).toBeUndefined(); // the gateway never runs tools (ADR-0007)
    expect(asSchema(clima?.inputSchema).jsonSchema).toEqual(parameters);
  });

  it("defaults the input schema to an empty object schema", () => {
    const { tools } = translateTools([fn("ping")], undefined);

    expect(asSchema(tools?.ping?.inputSchema).jsonSchema).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("passes strict: true to the tool and nothing for false, null or absent", () => {
    const { tools } = translateTools(
      [fn("a", { strict: true }), fn("b", { strict: false }), fn("c", { strict: null }), fn("d")],
      undefined,
    );

    expect(tools?.a?.strict).toBe(true);
    expect([tools?.b?.strict, tools?.c?.strict, tools?.d?.strict]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("returns no tools for an absent or empty list", () => {
    expect(translateTools(undefined, undefined).tools).toBeUndefined();
    expect(translateTools([], undefined).tools).toBeUndefined();
  });

  it("rejects a tool type other than function as unsupported_parameter", () => {
    const err = errorOf([fn("a"), { type: "custom", custom: { name: "x" } }]);

    expect(err).toMatchObject({ code: "unsupported_parameter", param: "tools[1].type" });
  });

  it("rejects duplicate names", () => {
    const err = errorOf([fn("a"), fn("a")]);

    expect(err).toMatchObject({ code: "invalid_request", param: "tools[1].function.name" });
  });

  it.each([
    ["a missing name", [{ type: "function", function: {} }], "tools[0].function.name"],
    ["a non-array tools", { type: "function" }, "tools"],
    ["non-object parameters", [fn("a", { parameters: "x" })], "tools[0].function.parameters"],
  ])("rejects %s with invalid_request and the path", (_name, tools, param) => {
    expect(errorOf(tools)).toMatchObject({ code: "invalid_request", param });
  });
});

describe("translateTools: tool_choice (SPEC-005 table)", () => {
  const tools = [fn("clima")];

  it.each([
    [undefined, undefined],
    ["auto", "auto"],
    ["none", "none"],
    ["required", "required"],
  ])("maps %p to %p", (input, expected) => {
    expect(translateTools(tools, input).toolChoice).toEqual(expected);
  });

  it("maps a named function to the AI SDK tool choice", () => {
    const choice = { type: "function", function: { name: "clima" } };

    expect(translateTools(tools, choice).toolChoice).toEqual({ type: "tool", toolName: "clima" });
  });

  it("rejects a tool_choice that names a tool that was not sent", () => {
    const err = errorOf(tools, { type: "function", function: { name: "outra" } });

    expect(err).toMatchObject({ code: "invalid_request", param: "tool_choice.function.name" });
  });

  it("rejects an unknown tool_choice", () => {
    expect(errorOf(tools, "sempre")).toMatchObject({
      code: "invalid_request",
      param: "tool_choice",
    });
  });

  it("rejects required or a named tool when no tools were sent, but not auto or none", () => {
    expect(errorOf(undefined, "required")).toMatchObject({
      code: "invalid_request",
      param: "tool_choice",
    });
    expect(translateTools(undefined, "auto").toolChoice).toBeUndefined();
    expect(translateTools(undefined, "none").toolChoice).toBeUndefined();
  });
});
