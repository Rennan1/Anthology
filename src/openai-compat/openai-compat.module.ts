import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ChatCompletionsController } from "./chat-completions.controller.js";
import { GatewayExceptionFilter } from "./errors/gateway-exception.filter.js";
import { ModelsController } from "./models.controller.js";
import { requestIdMiddleware } from "./request-id.middleware.js";

/** Espera CHAT_ROUTER e ROUTE_CATALOG (routing/) providos por um módulo global. */
@Module({
  controllers: [ChatCompletionsController, ModelsController],
  providers: [{ provide: APP_FILTER, useClass: GatewayExceptionFilter }],
})
export class OpenAiCompatModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes("*");
  }
}
