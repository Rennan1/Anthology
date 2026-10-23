import type {
  AssistantModelMessage,
  ImagePart,
  ModelMessage,
  TextPart,
  ToolCallPart,
  ToolModelMessage,
  UserModelMessage,
} from "ai";
import { z } from "zod";
import { assertNever } from "../../common/assert-never.js";
import { fail, type Path, parse } from "./parse.js";

const ROLES = ["system", "developer", "user", "assistant", "tool"] as const;

const RoleSchema = z.looseObject({ role: z.enum(ROLES) });
const PartSchema = z.looseObject({ type: z.string() });
const ContentMessageSchema = z.looseObject({ content: z.unknown().optional() });
const TextPartSchema = z.looseObject({ text: z.string() });
const ImagePartSchema = z.looseObject({ image_url: z.looseObject({ url: z.string() }) });
const ToolCallSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.looseObject({ name: z.string().min(1), arguments: z.string() }),
});
const AssistantMessageSchema = z.looseObject({
  content: z.unknown().optional(),
  tool_calls: z.array(ToolCallSchema).nullish(),
});
const ToolMessageSchema = z.looseObject({
  tool_call_id: z.string().min(1),
  content: z.unknown().optional(),
});

type Parts = { type: string }[];

/** A string or an array of parts. Checked by hand so a bad part reports its own path. */
function contentOf(raw: unknown, path: Path): string | Parts {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((part, j) => parse(PartSchema, part, [...path, j]));
  throw fail("invalid_request", "content must be a string or an array of content parts", path);
}

/** system, developer and tool content: a string or text parts, which are joined as they come. */
function textOf(content: string | Parts, path: Path, joiner: string): string {
  if (typeof content === "string") return content;
  return content
    .map((part, j) => {
      if (part.type !== "text") {
        throw fail("invalid_request", "Only text parts are allowed here", [...path, j, "type"]);
      }
      return parse(TextPartSchema, part, [...path, j]).text;
    })
    .join(joiner);
}

const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s;

function toImagePart(url: string, path: Path): ImagePart {
  const data = DATA_URL.exec(url);
  if (data !== null) {
    const [, mediaType = "", params = "", payload = ""] = data;
    if (!mediaType.startsWith("image/")) {
      throw fail("invalid_request", "A data URL image needs an image/* media type", path);
    }
    const bytes = params.split(";").includes("base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload));
    return { type: "image", image: new Uint8Array(bytes), mediaType };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw fail("invalid_request", "Not a valid image URL", path);
  }
  // Only fetchable web URLs: anything else (file:, ftp:) would make the provider read local data.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw fail("invalid_request", "Image URLs must be http, https or data", path);
  }
  return { type: "image", image: parsed };
}

function userPart(part: { type: string }, path: Path): TextPart | ImagePart {
  switch (part.type) {
    case "text":
      return { type: "text", text: parse(TextPartSchema, part, path).text };
    case "image_url": {
      const { image_url } = parse(ImagePartSchema, part, path);
      return toImagePart(image_url.url, [...path, "image_url", "url"]);
    }
    case "input_audio":
    case "file":
      throw fail("unsupported_parameter", `Content part '${part.type}' is not supported`, path);
    default:
      throw fail("invalid_request", `Unknown content part type '${part.type}'`, [...path, "type"]);
  }
}

function translateUser(message: unknown, path: Path): UserModelMessage {
  const { content: raw } = parse(ContentMessageSchema, message, path);
  const content = contentOf(raw, [...path, "content"]);
  if (typeof content === "string") return { role: "user", content };
  return {
    role: "user",
    content: content.map((part, j) => userPart(part, [...path, "content", j])),
  };
}

function toolInput(args: string, path: Path): unknown {
  if (args.trim() === "") return {};
  try {
    return JSON.parse(args);
  } catch {
    throw fail("invalid_request", "Tool call arguments are not valid JSON", path);
  }
}

function translateAssistant(
  message: unknown,
  path: Path,
  toolNames: Map<string, string>,
): AssistantModelMessage {
  const { content, tool_calls } = parse(AssistantMessageSchema, message, path);
  const text =
    content == null
      ? ""
      : textOf(contentOf(content, [...path, "content"]), [...path, "content"], "");
  const parts: (TextPart | ToolCallPart)[] = text === "" ? [] : [{ type: "text", text }];
  (tool_calls ?? []).forEach((call, j) => {
    toolNames.set(call.id, call.function.name);
    parts.push({
      type: "tool-call",
      toolCallId: call.id,
      toolName: call.function.name,
      input: toolInput(call.function.arguments, [
        ...path,
        "tool_calls",
        j,
        "function",
        "arguments",
      ]),
    });
  });
  return { role: "assistant", content: parts.length > 0 ? parts : [{ type: "text", text: "" }] };
}

function translateTool(
  message: unknown,
  path: Path,
  toolNames: ReadonlyMap<string, string>,
): ToolModelMessage {
  const { tool_call_id, content } = parse(ToolMessageSchema, message, path);
  const toolName = toolNames.get(tool_call_id);
  if (toolName === undefined) {
    throw fail("invalid_request", "tool_call_id sem tool_call correspondente", [
      ...path,
      "tool_call_id",
    ]);
  }
  const value = textOf(contentOf(content, [...path, "content"]), [...path, "content"], "");
  return {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: tool_call_id, toolName, output: { type: "text", value } },
    ],
  };
}

/** SPEC-005: OpenAI `messages` to AI SDK `ModelMessage[]`. Pure; the order is preserved. */
export function translateMessages(messages: readonly unknown[]): ModelMessage[] {
  // The OpenAI `tool` message has no tool name: it comes from the earlier assistant `tool_calls`.
  const toolNames = new Map<string, string>();
  return messages.map((message, i): ModelMessage => {
    const path: Path = ["messages", i];
    const { role } = parse(RoleSchema, message, path);
    switch (role) {
      case "system":
      case "developer": {
        const { content } = parse(ContentMessageSchema, message, path);
        return {
          role: "system",
          content: textOf(contentOf(content, [...path, "content"]), [...path, "content"], "\n\n"),
        };
      }
      case "user":
        return translateUser(message, path);
      case "assistant":
        return translateAssistant(message, path, toolNames);
      case "tool":
        return translateTool(message, path, toolNames);
      default:
        return assertNever(role);
    }
  });
}
