import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { result, router, startGateway } from "./harness.js";

const PYTHON = join(
  process.cwd(),
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

let app: NestExpressApplication;
let baseUrl: string;

beforeAll(async () => {
  ({ app, baseUrl } = await startGateway());
});
afterAll(async () => {
  await app.close();
});

/** Assíncrono de propósito: o gateway roda neste processo e precisa atender o Python enquanto ele roda. */
function runPytest(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, ["-m", "pytest", "-q", "test/contract/python"], {
      env: { ...process.env, ANTHOLOGY_BASE_URL: baseUrl },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe("SPEC-001 critério 2: SDK openai de Python (sem stream)", () => {
  it("passa o cenário de contrato em Python", async () => {
    // Sem o venv o critério não foi provado: falha alto em vez de pular (npm run setup:python).
    expect(existsSync(PYTHON)).toBe(true);
    router.reply(
      result(),
      result({
        text: "",
        finishReason: "tool-calls",
        toolCalls: [{ id: "call_1", name: "clima", input: { cidade: "Recife" } }],
      }),
      result({ text: "28 graus" }),
    );
    const run = await runPytest();
    expect(run.output).toContain("4 passed");
    expect(run.code).toBe(0);
  });
});
