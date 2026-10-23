import { Body, Controller, type INestApplication, Post } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { GatewayExceptionFilter } from "./errors/gateway-exception.filter.js";
import { configureJsonBody } from "./json-body.js";

const LIMIT = 200 * 1024;

@Controller("echo")
class EchoController {
  @Post()
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

describe("configureJsonBody", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [EchoController] }).compile();
    const nest = mod.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureJsonBody(nest, LIMIT);
    nest.useGlobalFilters(new GatewayExceptionFilter());
    await nest.init();
    app = nest;
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts JSON above the Nest default (100kb) up to the configured limit", async () => {
    const big = "x".repeat(150 * 1024);
    const res = await request(app.getHttpServer()).post("/echo").send({ big });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ big });
  });

  it("answers malformed JSON with 400 invalid_request in the OpenAI format", async () => {
    const res = await request(app.getHttpServer())
      .post("/echo")
      .set("content-type", "application/json")
      .send('{"a": SEGREDO-123');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      type: "invalid_request_error",
      code: "invalid_request",
      param: null,
    });
    expect(res.text).not.toContain("SEGREDO-123");
  });

  it("answers a body above the limit with 413 request_too_large", async () => {
    const res = await request(app.getHttpServer())
      .post("/echo")
      .send({ big: "x".repeat(LIMIT * 2) });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({
      type: "invalid_request_error",
      code: "request_too_large",
    });
  });
});
