import { randomUUID } from "node:crypto";
import { Body, Controller, Headers, Inject, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CHAT_ROUTER, type ChatRouter, type GatewayCaller } from "../routing/gateway.types.js";
import { Caller } from "./gateway-caller.decorator.js";
import { parseChatCompletionRequest } from "./request/chat-completion-request.js";
import { buildChatCompletion } from "./response/build-chat-completion.js";
import { buildGatewayHeaders } from "./response/gateway-headers.js";
import { streamToSse } from "./response/stream-to-sse.js";
import { createChunkMapper } from "./translate/stream-chunks.js";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  // Turns off response buffering in an nginx in front of the gateway (SPEC-006).
  "X-Accel-Buffering": "no",
};

@Controller("v1/chat/completions")
export class ChatCompletionsController {
  constructor(@Inject(CHAT_ROUTER) private readonly router: ChatRouter) {}

  // The response is written by hand: with `passthrough` Nest calls `res.send()` after the handler,
  // which fails once an SSE stream has already ended the response. Errors thrown before the first
  // byte still reach the exception filter, which answers in JSON.
  @Post()
  async create(
    @Body() body: unknown,
    @Headers("x-anthology-route") continuationRoute: string | undefined,
    @Caller() caller: GatewayCaller,
    @Res() res: Response,
  ): Promise<void> {
    const { request, stream, includeUsage } = parseChatCompletionRequest(body, continuationRoute);

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    if (!stream) {
      const result = await this.router.complete(request, caller, abort.signal);
      res
        .status(200)
        .set(buildGatewayHeaders(result))
        .json(buildChatCompletion({ id, created, requestedModel: request.model, result }));
      return;
    }

    // Resolves at the commit point (SPEC-003/006): the first upstream part is in hand.
    const committed = await this.router.stream(request, caller, abort.signal);
    res.status(200).set({ ...SSE_HEADERS, ...buildGatewayHeaders(committed) });
    res.flushHeaders();
    await streamToSse({
      res,
      parts: committed.parts,
      mapper: createChunkMapper({ id, created, model: request.model, includeUsage }),
    });
  }
}
