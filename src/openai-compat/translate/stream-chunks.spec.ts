import type { TextStreamPart, ToolSet } from "ai";
import {
  type ChatCompletionChunk,
  type ChunkEvent,
  createChunkMapper,
  type ToolCallDelta,
} from "./stream-chunks.js";

type Part = TextStreamPart<ToolSet>;

const usage = {
  inputTokens: 12,
  outputTokens: 3,
  totalTokens: 15,
  inputTokenDetails: { noCacheTokens: 12, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: 3, reasoningTokens: undefined },
};

const text = (value: string): Part => ({ type: "text-delta", id: "t", text: value });
const finish = (reason: "stop" | "length" | "tool-calls" | "interrupted" = "stop"): Part => ({
  type: "finish",
  finishReason: reason,
  rawFinishReason: reason,
  totalUsage: usage,
});
const inputStart = (id: string, toolName: string): Part => ({
  type: "tool-input-start",
  id,
  toolName,
});
const inputDelta = (id: string, delta: string): Part => ({ type: "tool-input-delta", id, delta });
const toolCall = (id: string, toolName: string, input: unknown): Part =>
  ({ type: "tool-call", toolCallId: id, toolName, input }) as Part;

function run(parts: Part[], includeUsage = false): ChunkEvent[] {
  const mapper = createChunkMapper({ id: "chatcmpl-1", created: 7, model: "code", includeUsage });
  return parts.flatMap((part) => mapper.map(part));
}

const chunks = (events: ChunkEvent[]): ChatCompletionChunk[] =>
  events.flatMap((event) => (event.kind === "chunk" ? [event.chunk] : []));

/** What the openai SDK does: group tool_call deltas by index, concatenating arguments. */
function accumulate(all: ChatCompletionChunk[]) {
  const calls: { id?: string; name?: string; arguments: string }[] = [];
  for (const delta of all.flatMap((chunk) => chunk.choices[0]?.delta.tool_calls ?? [])) {
    const call = (calls[delta.index] ??= { arguments: "" });
    if (delta.id !== undefined) call.id = delta.id;
    if (delta.function.name !== undefined) call.name = delta.function.name;
    call.arguments += delta.function.arguments ?? "";
  }
  return calls;
}

describe("createChunkMapper: text (criterion 1)", () => {
  it("emits role, then each delta, then finish_reason, in that exact order", () => {
    const out = chunks(
      run([
        { type: "start" },
        { type: "text-start", id: "t" },
        text("Olá"),
        text(" mundo"),
        { type: "text-end", id: "t" },
        finish(),
      ]),
    );

    expect(out.map((chunk) => chunk.choices[0])).toEqual([
      { index: 0, delta: { role: "assistant", content: "" }, finish_reason: null },
      { index: 0, delta: { content: "Olá" }, finish_reason: null },
      { index: 0, delta: { content: " mundo" }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: "stop" },
    ]);
  });

  it("keeps id, created and model identical in every chunk", () => {
    const out = chunks(run([text("a"), text("b"), finish()]));

    expect(new Set(out.map((c) => `${c.id}|${c.created}|${c.model}|${c.object}`))).toEqual(
      new Set(["chatcmpl-1|7|code|chat.completion.chunk"]),
    );
  });

  it("skips empty deltas and stays silent on structural and reasoning parts", () => {
    const out = chunks(
      run([
        { type: "start" },
        { type: "reasoning-start", id: "r" },
        { type: "reasoning-delta", id: "r", text: "pensando" },
        { type: "reasoning-end", id: "r" },
        text(""),
        { type: "text-start", id: "t" },
        { type: "text-end", id: "t" },
      ]),
    );

    expect(out).toEqual([]);
  });

  it("still sends the role chunk when the model finishes without content", () => {
    const out = chunks(run([finish()]));

    expect(out.map((c) => c.choices[0]?.delta)).toEqual([{ role: "assistant", content: "" }, {}]);
  });

  it("maps finish reasons through the OpenAI table, interrupted included", () => {
    const reasons = (reason: "length" | "tool-calls" | "interrupted") =>
      chunks(run([finish(reason)])).at(-1)?.choices[0]?.finish_reason;

    expect(reasons("length")).toBe("length");
    expect(reasons("tool-calls")).toBe("tool_calls");
    expect(reasons("interrupted")).toBe("stop");
  });
});

describe("createChunkMapper: tool calls (criteria 2 and 3)", () => {
  it("rebuilds two interleaved tool calls by index, with valid JSON arguments", () => {
    const out = chunks(
      run([
        inputStart("call_a", "clima"),
        inputStart("call_b", "hora"),
        inputDelta("call_a", '{"cida'),
        inputDelta("call_b", '{"zona":'),
        inputDelta("call_a", 'de":"Recife"}'),
        inputDelta("call_b", '"UTC"}'),
        { type: "tool-input-end", id: "call_a" },
        { type: "tool-input-end", id: "call_b" },
        toolCall("call_a", "clima", { cidade: "Recife" }),
        toolCall("call_b", "hora", { zona: "UTC" }),
        finish("tool-calls"),
      ]),
    );

    const calls = accumulate(out);
    expect(calls).toEqual([
      { id: "call_a", name: "clima", arguments: '{"cidade":"Recife"}' },
      { id: "call_b", name: "hora", arguments: '{"zona":"UTC"}' },
    ]);
    expect(calls.map((call) => JSON.parse(call.arguments))).toEqual([
      { cidade: "Recife" },
      { zona: "UTC" },
    ]);
    expect(out.at(-1)?.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("opens a tool call with id, type, name and empty arguments", () => {
    const out = chunks(run([inputStart("call_a", "clima")]));

    expect(out[1]?.choices[0]?.delta.tool_calls).toEqual<ToolCallDelta[]>([
      { index: 0, id: "call_a", type: "function", function: { name: "clima", arguments: "" } },
    ]);
  });

  it("sends a tool-call that never streamed its input as one complete chunk", () => {
    const out = chunks(
      run([toolCall("call_x", "clima", { cidade: "Natal" }), finish("tool-calls")]),
    );

    expect(out[0]?.choices[0]?.delta).toEqual({ role: "assistant", content: "" });
    expect(out[1]?.choices[0]?.delta.tool_calls).toEqual<ToolCallDelta[]>([
      {
        index: 0,
        id: "call_x",
        type: "function",
        function: { name: "clima", arguments: '{"cidade":"Natal"}' },
      },
    ]);
    expect(out).toHaveLength(3);
  });

  it("does not repeat a tool call whose input was already streamed", () => {
    const out = chunks(
      run([
        inputStart("c", "f"),
        inputDelta("c", "{}"),
        toolCall("c", "f", {}),
        finish("tool-calls"),
      ]),
    );

    expect(accumulate(out)).toEqual([{ id: "c", name: "f", arguments: "{}" }]);
  });

  it("numbers indexes by first appearance across streamed and whole tool calls", () => {
    const out = chunks(
      run([toolCall("w", "whole", {}), inputStart("s", "streamed"), inputDelta("s", "{}")]),
    );

    expect(accumulate(out).map((call) => call.id)).toEqual(["w", "s"]);
  });

  it("ignores an input delta for a tool call it never saw open", () => {
    const out = chunks(run([inputDelta("ghost", "{}")]));

    expect(out).toEqual([]);
  });
});

describe("createChunkMapper: usage (criterion 4)", () => {
  it("adds a usage chunk with empty choices after the finish chunk when asked", () => {
    const out = chunks(run([text("a"), finish()], true));

    expect(out.at(-2)?.choices[0]?.finish_reason).toBe("stop");
    expect(out.at(-1)).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
  });

  it("puts no usage anywhere when not asked", () => {
    const out = chunks(run([text("a"), finish()], false));

    expect(out.some((chunk) => "usage" in chunk)).toBe(false);
  });
});

describe("createChunkMapper: errors and the end", () => {
  it("turns an error part into an error event", () => {
    const events = run([text("a"), { type: "error", error: new Error("boom") }]);

    expect(events.at(-1)).toEqual({ kind: "error" });
  });

  it("reports finished only after the finish part", () => {
    const mapper = createChunkMapper({ id: "i", created: 1, model: "m", includeUsage: false });

    mapper.map(text("a"));
    const before = mapper.finished;
    mapper.map(finish());

    expect([before, mapper.finished]).toEqual([false, true]);
  });
});
