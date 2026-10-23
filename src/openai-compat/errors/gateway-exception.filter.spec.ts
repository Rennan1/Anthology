import { jest } from "@jest/globals";
import { Controller, Get, type INestApplication, Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { GatewayError, type GatewayErrorCode } from "../../routing/gateway-error.js";
import { GatewayExceptionFilter } from "./gateway-exception.filter.js";

const SECRET = "SEGREDO-123";

@Controller("t")
class ThrowingController {
  @Get("gw/:code")
  gateway(): never {
    throw new GatewayError("invalid_request", "unused");
  }
  @Get("boom")
  boom(): never {
    throw new Error(`falha interna ${SECRET}`);
  }
}

// Controller dinâmico: um GatewayError por linha da tabela da SPEC-001 (critério 3).
const ROWS: ReadonlyArray<[GatewayErrorCode, number, string, number | undefined]> = [
  ["invalid_request", 400, "invalid_request_error", undefined],
  ["unsupported_parameter", 400, "invalid_request_error", undefined],
  ["unsupported_capability", 400, "invalid_request_error", undefined],
  ["invalid_api_key", 401, "authentication_error", undefined],
  ["model_not_found", 404, "invalid_request_error", undefined],
  ["unknown_url", 404, "invalid_request_error", undefined],
  ["request_too_large", 413, "invalid_request_error", undefined],
  ["upstream_rate_limited", 429, "rate_limit_error", undefined],
  ["upstream_unavailable", 502, "api_error", undefined],
  ["upstream_timeout", 504, "api_error", undefined],
  ["upstream_rejected", 422, "invalid_request_error", 422],
  ["internal_error", 500, "api_error", undefined],
];

describe("GatewayExceptionFilter", () => {
  let app: INestApplication;
  let current: GatewayError;

  @Controller("e")
  class EchoController {
    @Get()
    get(): never {
      throw current;
    }
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [EchoController, ThrowingController],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new GatewayExceptionFilter());
    await app.init();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(ROWS)("%s -> %i %s over HTTP", async (code, status, type, upstreamStatus) => {
    current = new GatewayError(code, "msg", { param: "model", upstreamStatus });
    const res = await request(app.getHttpServer()).get("/e");
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: { message: "msg", type, param: "model", code } });
  });

  it("answers an unexpected error with generic 500, logs it, and never leaks the message", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const res = await request(app.getHttpServer()).get("/t/boom");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ type: "api_error", code: "internal_error" });
    expect(res.text).not.toContain(SECRET);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("does not log expected GatewayErrors as errors", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    current = new GatewayError("model_not_found", "nope");
    await request(app.getHttpServer()).get("/e");
    expect(logSpy).not.toHaveBeenCalled();
  });
});
