import { Inject, Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigModule, GATEWAY_CONFIG } from "./config.module.js";
import { ConfigError } from "./config-error.js";
import type { GatewayConfig } from "./gateway-config.js";

const ENV = {
  OPENROUTER_API_KEY: "provider-key-sentinel",
  ANTHOLOGY_KEY_BACKOFFICE: "gateway-key-backoffice-sentinel",
  ANTHOLOGY_KEY_CHATBOT: "gateway-key-chatbot-sentinel",
};

@Injectable()
class Consumer {
  constructor(@Inject(GATEWAY_CONFIG) readonly config: GatewayConfig) {}
}

@Module({ providers: [Consumer], exports: [Consumer] })
class ConsumerModule {}

function compile(env: NodeJS.ProcessEnv) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        path: "anthology.config.example.json",
        env,
        providerTypes: ["openrouter"],
      }),
      ConsumerModule,
    ],
  }).compile();
}

describe("ConfigModule", () => {
  it("provides the frozen GatewayConfig to any module", async () => {
    const moduleRef = await compile(ENV);

    const { config } = moduleRef.get(Consumer);

    expect(config.routes.code?.target).toBe("sonnet");
    expect(Object.isFrozen(config.routes)).toBe(true);
  });

  it("aborts the boot with a ConfigError that names the variable, never a value", async () => {
    const { OPENROUTER_API_KEY: _omitted, ...env } = ENV;

    const boot = compile(env);

    await expect(boot).rejects.toBeInstanceOf(ConfigError);
    await expect(boot).rejects.toThrow(/OPENROUTER_API_KEY/);
    await expect(boot).rejects.not.toThrow(ENV.ANTHOLOGY_KEY_CHATBOT);
  });
});
