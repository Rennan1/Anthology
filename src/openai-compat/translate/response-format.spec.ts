import { GatewayError } from "../../routing/gateway-error.js";
import { translateResponseFormat } from "./response-format.js";

function errorOf(format: unknown): GatewayError {
  try {
    translateResponseFormat(format);
  } catch (err) {
    if (err instanceof GatewayError) return err;
    throw err;
  }
  throw new Error("expected GatewayError");
}

describe("translateResponseFormat (SPEC-005 table)", () => {
  it.each([[undefined], [null], [{ type: "text" }]])("%p is plain text generation", (format) => {
    expect(translateResponseFormat(format)).toBeUndefined();
  });

  it("maps json_object", () => {
    expect(translateResponseFormat({ type: "json_object" })).toEqual({ type: "json_object" });
  });

  it("maps json_schema, dropping strict (the provider owns that guarantee)", () => {
    const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };

    expect(
      translateResponseFormat({
        type: "json_schema",
        json_schema: { name: "resultado", description: "um número", schema, strict: true },
      }),
    ).toEqual({ type: "json_schema", name: "resultado", description: "um número", schema });
  });

  it("omits the description when there is none", () => {
    const out = translateResponseFormat({
      type: "json_schema",
      json_schema: { name: "r", schema: {} },
    });

    expect(out).not.toHaveProperty("description");
  });

  it.each([
    [
      "json_schema without the json_schema object",
      { type: "json_schema" },
      "response_format.json_schema",
    ],
    [
      "json_schema without a name",
      { type: "json_schema", json_schema: { schema: {} } },
      "response_format.json_schema.name",
    ],
    [
      "json_schema with a non-object schema",
      { type: "json_schema", json_schema: { name: "r", schema: "x" } },
      "response_format.json_schema.schema",
    ],
  ])("rejects %s", (_name, format, param) => {
    expect(errorOf(format)).toMatchObject({ code: "invalid_request", param });
  });
});
