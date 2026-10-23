import { type JSONSchema7, jsonSchema, type ToolChoice, type ToolSet, tool } from "ai";
import { z } from "zod";
import { fail, parse } from "./parse.js";

export interface TranslatedTools {
  readonly tools: ToolSet | undefined;
  readonly toolChoice: ToolChoice<ToolSet> | undefined;
}

const KindSchema = z.looseObject({ type: z.string() });
const FunctionToolSchema = z.looseObject({
  function: z.looseObject({
    name: z.string().min(1),
    description: z.string().nullish(),
    parameters: z.record(z.string(), z.unknown()).nullish(),
    strict: z.boolean().nullish(),
  }),
});
const NamedChoiceSchema = z.looseObject({
  type: z.literal("function"),
  function: z.looseObject({ name: z.string().min(1) }),
});

const EMPTY_OBJECT_SCHEMA: JSONSchema7 = { type: "object", properties: {} };

function translateToolSet(raw: unknown): ToolSet | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw fail("invalid_request", "tools must be an array", ["tools"]);
  if (raw.length === 0) return undefined;
  const tools: ToolSet = {};
  raw.forEach((entry, i) => {
    const path = ["tools", i];
    const { type } = parse(KindSchema, entry, path);
    if (type !== "function") {
      throw fail("unsupported_parameter", `Tool type '${type}' is not supported`, [
        ...path,
        "type",
      ]);
    }
    const { description, parameters, strict, name } = parse(
      FunctionToolSchema,
      entry,
      path,
    ).function;
    if (name in tools) {
      throw fail("invalid_request", `Duplicate tool name '${name}'`, [...path, "function", "name"]);
    }
    // No `execute`: the gateway never runs tools (ADR-0007). `strict` is the AI SDK's own flag.
    tools[name] = tool({
      ...(description != null && { description }),
      inputSchema: jsonSchema(
        (parameters as JSONSchema7 | null | undefined) ?? EMPTY_OBJECT_SCHEMA,
      ),
      ...(strict === true && { strict: true }),
    });
  });
  return tools;
}

function translateToolChoice(
  raw: unknown,
  tools: ToolSet | undefined,
): ToolChoice<ToolSet> | undefined {
  if (raw === undefined || raw === null) return undefined;
  const invalid = (message: string, path: readonly PropertyKey[] = ["tool_choice"]) =>
    fail("invalid_request", message, path);
  if (raw === "auto" || raw === "none") return tools === undefined ? undefined : raw;
  if (raw === "required") {
    if (tools === undefined) throw invalid("tool_choice 'required' needs tools");
    return "required";
  }
  const named = NamedChoiceSchema.safeParse(raw);
  if (!named.success) throw invalid("tool_choice must be auto, none, required or a named function");
  const toolName = named.data.function.name;
  if (tools === undefined || !(toolName in tools)) {
    throw invalid(`tool_choice names '${toolName}', which is not in tools`, [
      "tool_choice",
      "function",
      "name",
    ]);
  }
  return { type: "tool", toolName };
}

/** SPEC-005: OpenAI `tools` and `tool_choice` to the AI SDK. Pure. */
export function translateTools(rawTools: unknown, rawToolChoice: unknown): TranslatedTools {
  const tools = translateToolSet(rawTools);
  return { tools, toolChoice: translateToolChoice(rawToolChoice, tools) };
}
