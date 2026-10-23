import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { APICallError, generateText } from "ai";
import { openRouterFactory } from "./openrouter.factory.js";

interface Seen {
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

const COMPLETION = {
  id: "gen-1",
  object: "chat.completion",
  created: 1,
  model: "anthropic/claude-sonnet-4.5",
  choices: [{ index: 0, message: { role: "assistant", content: "olá" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
};

let server: Server;
let baseURL: string;
let seen: Seen[];
let reply: { status: number; body: unknown };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  seen = [];
  reply = { status: 200, body: COMPLETION };
});

const provider = () =>
  openRouterFactory.create({
    apiKey: "provider-key-sentinel",
    baseURL,
    headers: { "HTTP-Referer": "https://anthology.interno", "X-Title": "Anthology" },
    options: {},
  });

const generate = () =>
  generateText({
    model: provider().languageModel("anthropic/claude-sonnet-4.5"),
    messages: [{ role: "user", content: "oi" }],
    maxRetries: 0,
  });

describe("openRouterFactory", () => {
  it("declares the openrouter type and namespace, and takes no options", () => {
    expect(openRouterFactory.type).toBe("openrouter");
    expect(openRouterFactory.optionsNamespace).toBe("openrouter");
    expect(openRouterFactory.optionsSchema.safeParse({}).success).toBe(true);
    expect(openRouterFactory.optionsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it("calls the configured baseURL with the provider key and the attribution headers", async () => {
    const result = await generate();

    expect(result.text).toBe("olá");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers).toMatchObject({
      authorization: "Bearer provider-key-sentinel",
      "http-referer": "https://anthology.interno",
      "x-title": "Anthology",
    });
    expect(seen[0]?.body).toMatchObject({ model: "anthropic/claude-sonnet-4.5" });
  });

  it("sends providerOptions given under the openrouter namespace in the request body", async () => {
    await generateText({
      model: provider().languageModel("anthropic/claude-sonnet-4.5"),
      messages: [{ role: "user", content: "oi" }],
      maxRetries: 0,
      providerOptions: { openrouter: { provider: { order: ["anthropic"] } } },
    });

    expect(seen[0]?.body.provider).toEqual({ order: ["anthropic"] });
  });

  it("turns an upstream HTTP error into an APICallError with its statusCode", async () => {
    reply = { status: 429, body: { error: { message: "slow down", code: 429 } } };

    const failure = await generate().catch((error: unknown) => error);

    expect(APICallError.isInstance(failure)).toBe(true);
    expect((failure as APICallError).statusCode).toBe(429);
  });
});
