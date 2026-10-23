import { HttpException } from "@nestjs/common";
import { GatewayError, type GatewayErrorCode } from "../../routing/gateway-error.js";
import { toErrorResponse } from "./to-error-response.js";

const SECRET = "SEGREDO-123";

// SPEC-001, tabela de erros: code -> [status, type]
const TABLE: ReadonlyArray<[GatewayErrorCode, number, string]> = [
  ["invalid_request", 400, "invalid_request_error"],
  ["unsupported_parameter", 400, "invalid_request_error"],
  ["unsupported_capability", 400, "invalid_request_error"],
  ["invalid_api_key", 401, "authentication_error"],
  ["model_not_found", 404, "invalid_request_error"],
  ["unknown_url", 404, "invalid_request_error"],
  ["request_too_large", 413, "invalid_request_error"],
  ["upstream_rate_limited", 429, "rate_limit_error"],
  ["upstream_unavailable", 502, "api_error"],
  ["upstream_timeout", 504, "api_error"],
  ["internal_error", 500, "api_error"],
];

describe("toErrorResponse", () => {
  it.each(TABLE)("maps GatewayError %s to %i %s", (code, status, type) => {
    const res = toErrorResponse(new GatewayError(code, "boom", { param: "model" }));
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: { message: "boom", type, param: "model", code } });
  });

  it("uses param null when absent", () => {
    expect(toErrorResponse(new GatewayError("invalid_request", "x")).body.error.param).toBeNull();
  });

  describe("upstream_rejected", () => {
    it.each([
      [422, 422],
      [400, 400],
      [499, 499],
      [200, 400],
      [500, 400],
      [399, 400],
      [undefined, 400],
      [Number.NaN, 400],
      [418.5, 400],
    ])("upstreamStatus %s -> %s", (upstreamStatus, expected) => {
      const res = toErrorResponse(new GatewayError("upstream_rejected", "no", { upstreamStatus }));
      expect(res.status).toBe(expected);
      expect(res.body.error.type).toBe("invalid_request_error");
      expect(res.body.error.code).toBe("upstream_rejected");
    });
  });

  describe("body-parser and Nest errors", () => {
    it("maps entity.too.large to 413 request_too_large", () => {
      const res = toErrorResponse(
        Object.assign(new Error("request entity too large"), {
          type: "entity.too.large",
          status: 413,
        }),
      );
      expect(res.status).toBe(413);
      expect(res.body.error).toMatchObject({
        type: "invalid_request_error",
        code: "request_too_large",
      });
    });

    it("maps entity.parse.failed to 400 invalid_request", () => {
      const res = toErrorResponse(
        Object.assign(new SyntaxError(`Unexpected token ${SECRET}`), {
          type: "entity.parse.failed",
          status: 400,
        }),
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        type: "invalid_request_error",
        code: "invalid_request",
      });
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it("maps HttpException 400 to invalid_request and 413 to request_too_large", () => {
      expect(toErrorResponse(new HttpException("x", 400)).body.error.code).toBe("invalid_request");
      expect(toErrorResponse(new HttpException("x", 413)).status).toBe(413);
      expect(toErrorResponse(new HttpException("x", 413)).body.error.code).toBe(
        "request_too_large",
      );
    });

    it("maps body-parser 4xx without a table row (415, bad charset/encoding) to a 400 that says so", () => {
      const err = Object.assign(new Error(SECRET), { type: "charset.unsupported", status: 415 });
      const res = toErrorResponse(err);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_request");
      expect(res.body.error.message).not.toContain("JSON");
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it("maps a 4xx body-parser error that carries only a status (corrupt br/gzip body) to 400", () => {
      const err = Object.assign(new Error(SECRET), {
        status: 400,
        code: "ERR__ERROR_FORMAT_PADDING_2",
      });
      const res = toErrorResponse(err);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_request");
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it("maps a 413 that carries only a status, whatever its type", () => {
      const res = toErrorResponse(Object.assign(new Error("too big"), { status: 413 }));
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe("request_too_large");
    });

    it("does not call a non-body 400 (e.g. malformed URI) 'not valid JSON'", () => {
      const res = toErrorResponse(new HttpException(SECRET, 400));
      expect(res.status).toBe(400);
      expect(res.body.error.message).not.toContain("JSON");
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it("maps HttpException 404 (rota inexistente) to unknown_url without leaking the path", () => {
      const res = toErrorResponse(new HttpException(`Cannot GET /v1/${SECRET}`, 404));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("unknown_url");
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it("maps other HttpException statuses to 500 internal_error without leaking the message", () => {
      const res = toErrorResponse(new HttpException(SECRET, 418));
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("internal_error");
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });
  });

  describe("never leaks", () => {
    const cases: Array<[string, unknown]> = [
      ["Error", new Error(`falha ${SECRET}`)],
      ["string", SECRET],
      ["object", { message: SECRET, stack: SECRET }],
      ["null", null],
    ];
    it.each(cases)("unknown %s -> generic 500", (_n, err) => {
      const res = toErrorResponse(err);
      expect(res.status).toBe(500);
      expect(res.body.error).toMatchObject({
        type: "api_error",
        code: "internal_error",
        param: null,
      });
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it("does not expose GatewayError cause or stack", () => {
      const err = new GatewayError("upstream_unavailable", "all candidates failed", {
        cause: new Error(`upstream body ${SECRET}`),
      });
      const text = JSON.stringify(toErrorResponse(err).body);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("at ");
    });
  });
});
