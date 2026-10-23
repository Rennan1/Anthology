// Smoke real contra o OpenRouter (SPEC-004, critério 5): completion, stream e um tool call.
// Sem OPENROUTER_API_KEY sai com código 3 e "nao_verificado": nunca verde, nunca pulado em silêncio.
import { generateText, jsonSchema, streamText, tool } from "ai";
import { openRouterFactory } from "../../dist/providers/openrouter/openrouter.factory.js";

const NAO_VERIFICADO = 3;
const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey === "") {
  console.log("nao_verificado: OPENROUTER_API_KEY ausente, o provedor real não foi chamado");
  process.exit(NAO_VERIFICADO);
}

const modelId = process.env.ANTHOLOGY_SMOKE_MODEL ?? "openai/gpt-5-mini";
const model = openRouterFactory
  .create({ apiKey, options: {}, headers: { "X-Title": "Anthology smoke" } })
  .languageModel(modelId);
const messages = (content) => [{ role: "user", content }];

const completion = await generateText({
  model,
  messages: messages("Responda apenas: ok"),
  maxRetries: 0,
});
if (completion.text.trim() === "") throw new Error("completion: resposta vazia");
console.log(`completion ok (${completion.usage.totalTokens ?? "?"} tokens)`);

let streamed = "";
for await (const delta of streamText({ model, messages: messages("Conte de 1 a 3"), maxRetries: 0 })
  .textStream) {
  streamed += delta;
}
if (streamed.trim() === "") throw new Error("stream: nenhum texto");
console.log("stream ok");

const withTool = await generateText({
  model,
  messages: messages("Qual o clima em São Paulo? Use a ferramenta."),
  tools: {
    get_weather: tool({
      description: "Clima atual de uma cidade",
      inputSchema: jsonSchema({
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      }),
    }),
  },
  toolChoice: "required",
  maxRetries: 0,
});
if (withTool.toolCalls.length !== 1) throw new Error("tool call: esperava exatamente 1 chamada");
console.log("tool call ok");
