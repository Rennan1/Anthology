import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { NestExpressApplication } from "@nestjs/platform-express";
import OpenAI from "openai";
import { GatewayError } from "../../src/routing/gateway-error.js";
import { result, router, startGateway, VALID_KEY } from "./harness.js";

let app: NestExpressApplication;
let client: OpenAI;
let baseUrl: string;

beforeAll(async () => {
  ({ app, client, baseUrl } = await startGateway());
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => router.reply());

const hello = [{ role: "user" as const, content: "oi" }];

describe("SPEC-001 critério 1: SDK openai só troca baseURL e apiKey", () => {
  it("lista modelos com auto em primeiro lugar (critério 6)", async () => {
    const page = await client.models.list();
    expect(page.data.map((m) => m.id)).toEqual(["auto", "code", "general"]);
    expect(page.data.every((m) => m.owned_by === "anthology")).toBe(true);
  });

  it("recupera uma Rota visível e devolve 404 model_not_found para outra", async () => {
    expect((await client.models.retrieve("code")).id).toBe("code");
    expect((await client.models.retrieve("auto")).id).toBe("auto");
    await expect(client.models.retrieve("secreta")).rejects.toMatchObject({
      status: 404,
      code: "model_not_found",
    });
  });

  it("completa sem stream e expõe os headers x-anthology-*", async () => {
    router.reply(result());
    const { data, response } = await client.chat.completions
      .create({ model: "code", messages: hello })
      .withResponse();
    expect(data.choices[0]?.message).toMatchObject({ role: "assistant", content: "olá" });
    expect(data.choices[0]?.finish_reason).toBe("stop");
    expect(data.usage).toEqual({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });
    expect(data.id).toMatch(/^chatcmpl-[0-9a-f-]{36}$/);
    expect(response.headers.get("x-anthology-route")).toBe("code");
    expect(response.headers.get("x-anthology-routed-by")).toBe("client");
    expect(response.headers.get("x-anthology-model")).toBe("sonnet");
    expect(response.headers.get("x-anthology-attempts")).toBe("1");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("completa um ciclo de tool call (pedido → tool_calls → tool → resposta final)", async () => {
    router.reply(
      result({
        text: "",
        finishReason: "tool-calls",
        toolCalls: [{ id: "call_1", name: "clima", input: { cidade: "Recife" } }],
      }),
      result({ text: "28 graus" }),
    );
    const tools = [
      {
        type: "function" as const,
        function: { name: "clima", parameters: { type: "object", properties: {} } },
      },
    ];
    const first = await client.chat.completions.create({ model: "code", messages: hello, tools });
    const message = first.choices[0]?.message;
    const call = message?.tool_calls?.[0];
    expect(first.choices[0]?.finish_reason).toBe("tool_calls");
    expect(message?.content).toBeNull();
    expect(call).toMatchObject({ id: "call_1", type: "function" });
    expect(call && "function" in call && JSON.parse(call.function.arguments)).toEqual({
      cidade: "Recife",
    });

    const second = await client.chat.completions.create({
      model: "code",
      tools,
      messages: [
        ...hello,
        message as OpenAI.Chat.ChatCompletionAssistantMessageParam,
        { role: "tool", tool_call_id: "call_1", content: "28" },
      ],
    });
    expect(second.choices[0]?.message.content).toBe("28 graus");
    expect(router.received[1]?.messages).toHaveLength(3);
  });
});

describe("SPEC-001 critério 4: parâmetros", () => {
  it("n: 2 → 400 unsupported_parameter com param n, e o roteamento não é chamado", async () => {
    await expect(
      client.chat.completions.create({ model: "code", messages: hello, n: 2 }),
    ).rejects.toMatchObject({ status: 400, code: "unsupported_parameter", param: "n" });
    expect(router.received).toHaveLength(0);
  });

  it("campo desconhecido não muda a resposta", async () => {
    router.reply(result(), result());
    const plain = await client.chat.completions.create({ model: "code", messages: hello });
    const extra = await client.chat.completions.create({
      model: "code",
      messages: hello,
      // @ts-expect-error campo que o SDK não conhece
      foo: 1,
    });
    expect({ ...extra, id: "", created: 0 }).toEqual({ ...plain, id: "", created: 0 });
  });

  it("stream: true é recusado até a SPEC-006", async () => {
    await expect(
      client.chat.completions.create({ model: "code", messages: hello, stream: true }),
    ).rejects.toMatchObject({ status: 400, code: "unsupported_parameter", param: "stream" });
  });
});

describe("SPEC-001 critério 5: fallback", () => {
  it("model do corpo é a Rota; x-anthology-model e attempts vêm do resultado", async () => {
    router.reply(result({ modelKey: "mini", attempts: 2 }));
    const { data, response } = await client.chat.completions
      .create({ model: "code", messages: hello })
      .withResponse();
    expect(data.model).toBe("code");
    expect(response.headers.get("x-anthology-model")).toBe("mini");
    expect(response.headers.get("x-anthology-attempts")).toBe("2");
  });
});

describe("SPEC-001 critério 6: model auto e continuação", () => {
  it("auto ecoa auto no corpo; o header x-anthology-route chega ao roteamento", async () => {
    router.reply(result({ route: "code", routedBy: "continuation" }));
    const { data, response } = await client.chat.completions
      .create({ model: "auto", messages: hello }, { headers: { "x-anthology-route": "code" } })
      .withResponse();
    expect(data.model).toBe("auto");
    expect(response.headers.get("x-anthology-routed-by")).toBe("continuation");
    expect(router.received[0]).toMatchObject({ model: "auto", continuationRoute: "code" });
  });
});

describe("SPEC-001 critério 3: erros pelo SDK e pela fiação", () => {
  it("sem chave válida → 401 invalid_api_key", async () => {
    const bad = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "errada", maxRetries: 0 });
    await expect(bad.models.list()).rejects.toMatchObject({
      status: 401,
      code: "invalid_api_key",
      type: "authentication_error",
    });
  });

  it.each([
    ["upstream_rate_limited", 429, "rate_limit_error"],
    ["upstream_unavailable", 502, "api_error"],
    ["upstream_timeout", 504, "api_error"],
    ["unsupported_capability", 400, "invalid_request_error"],
    ["model_not_found", 404, "invalid_request_error"],
  ] as const)("erro %s do roteamento vira %i no SDK", async (code, status, type) => {
    router.reply(new GatewayError(code, "x"));
    await expect(
      client.chat.completions.create({ model: "code", messages: hello }),
    ).rejects.toMatchObject({ status, code, type });
  });

  it("erro inesperado do roteamento → 500 internal_error sem vazar a mensagem", async () => {
    router.reply();
    const err = await client.chat.completions
      .create({ model: "code", messages: hello })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, code: "internal_error" });
    expect(JSON.stringify(err)).not.toContain("script esgotado");
  });

  it("x-request-id do cliente é ecoado", async () => {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${VALID_KEY}`, "x-request-id": "req-abc" },
    });
    expect(res.headers.get("x-request-id")).toBe("req-abc");
  });
});

describe("rotas fecham quando nenhum guard identificou o chamador", () => {
  it("→ 401 invalid_api_key em vez de atender", async () => {
    const open = await startGateway({ guarded: false });
    try {
      await expect(open.client.models.list()).rejects.toMatchObject({
        status: 401,
        code: "invalid_api_key",
      });
    } finally {
      await open.app.close();
    }
  });
});
