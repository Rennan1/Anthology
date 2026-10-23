import { randomUUID } from "node:crypto";
import { Body, Controller, Headers, HttpCode, Inject, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CHAT_ROUTER, type ChatRouter, type GatewayCaller } from "../routing/gateway.types.js";
import { GatewayError } from "../routing/gateway-error.js";
import { Caller } from "./gateway-caller.decorator.js";
import { parseChatCompletionRequest } from "./request/chat-completion-request.js";
import { buildChatCompletion } from "./response/build-chat-completion.js";
import { buildGatewayHeaders } from "./response/gateway-headers.js";

@Controller("v1/chat/completions")
export class ChatCompletionsController {
  constructor(@Inject(CHAT_ROUTER) private readonly router: ChatRouter) {}

  @Post()
  @HttpCode(200)
  async create(
    @Body() body: unknown,
    @Headers("x-anthology-route") continuationRoute: string | undefined,
    @Caller() caller: GatewayCaller,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { request, stream } = parseChatCompletionRequest(body, continuationRoute);
    if (stream) {
      // SPEC-006 ainda não implementada: recusar é melhor que devolver JSON a quem pediu SSE.
      throw new GatewayError("unsupported_parameter", "Streaming is not supported yet.", {
        param: "stream",
      });
    }

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    const result = await this.router.complete(request, caller, abort.signal);
    res.set(buildGatewayHeaders(result));
    return buildChatCompletion({
      id: `chatcmpl-${randomUUID()}`,
      created: Math.floor(Date.now() / 1000),
      requestedModel: request.model,
      result,
    });
  }
}
