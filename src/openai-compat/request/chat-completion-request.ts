import { z } from "zod";
import { formatJsonPath } from "../../common/json-path.js";
import type { GatewayRequest, GenerationParams } from "../../routing/gateway.types.js";
import { GatewayError } from "../../routing/gateway-error.js";
import { translateMessages } from "../translate/messages.js";
import { translateResponseFormat } from "../translate/response-format.js";
import { translateTools } from "../translate/tools.js";

export interface ParsedChatCompletion {
  readonly request: GatewayRequest;
  readonly stream: boolean;
  readonly includeUsage: boolean;
}

const ROLES = ["system", "developer", "user", "assistant", "tool"] as const;

const bodySchema = z.object({
  model: z.string().min(1),
  // Message parts are validated by the translation (SPEC-005); here only the role.
  messages: z.array(z.looseObject({ role: z.enum(ROLES) })).min(1),
  temperature: z.number().min(0).max(2).nullish(),
  top_p: z.number().min(0).max(1).nullish(),
  seed: z.int().nullish(),
  presence_penalty: z.number().min(-2).max(2).nullish(),
  frequency_penalty: z.number().min(-2).max(2).nullish(),
  stop: z.union([z.string(), z.array(z.string()).max(4)]).nullish(),
  max_completion_tokens: z.int().positive().nullish(),
  max_tokens: z.int().positive().nullish(),
  tools: z.array(z.unknown()).nullish(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().nullish(),
  response_format: z
    .looseObject({ type: z.enum(["text", "json_object", "json_schema"]) })
    .nullish(),
  user: z.string().nullish(),
  stream: z.boolean().nullish(),
  stream_options: z.object({ include_usage: z.boolean().nullish() }).nullish(),
});

type ParsedBody = z.infer<typeof bodySchema>;

function toParams(body: ParsedBody): GenerationParams {
  const stop =
    body.stop == null ? undefined : typeof body.stop === "string" ? [body.stop] : body.stop;
  return {
    ...(body.temperature != null && { temperature: body.temperature }),
    ...(body.top_p != null && { topP: body.top_p }),
    ...(body.seed != null && { seed: body.seed }),
    ...(body.presence_penalty != null && { presencePenalty: body.presence_penalty }),
    ...(body.frequency_penalty != null && { frequencyPenalty: body.frequency_penalty }),
    ...(stop && { stop }),
    // SPEC-001: max_completion_tokens wins when both are sent.
    ...((body.max_completion_tokens ?? body.max_tokens) != null && {
      maxOutputTokens: body.max_completion_tokens ?? body.max_tokens ?? undefined,
    }),
  };
}

/** Known parameters the gateway does not honor: any non-null value is rejected (SPEC-001). */
const UNSUPPORTED_WHEN_PRESENT = [
  "top_logprobs",
  "logit_bias",
  "functions",
  "function_call",
  "audio",
  "prediction",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unsupported(param: string): GatewayError {
  return new GatewayError("unsupported_parameter", `Parameter '${param}' is not supported`, {
    param,
  });
}

// null counts as absent: OpenAI clients send explicit nulls. `logprobs: false` is honorable
// (nothing to return), so only a non-false value is rejected.
function rejectUnsupported(body: Record<string, unknown>): void {
  if (body.n != null && body.n !== 1) throw unsupported("n");
  if (body.logprobs != null && body.logprobs !== false) throw unsupported("logprobs");
  for (const field of UNSUPPORTED_WHEN_PRESENT) {
    if (body[field] != null) throw unsupported(field);
  }
  if (Array.isArray(body.modalities) && body.modalities.includes("audio")) {
    throw unsupported("modalities");
  }
}

export function parseChatCompletionRequest(
  body: unknown,
  continuationRoute: string | undefined,
): ParsedChatCompletion {
  if (isRecord(body)) rejectUnsupported(body);
  const result = bodySchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new GatewayError("invalid_request", issue?.message ?? "Invalid request body", {
      param: formatJsonPath(issue?.path ?? []) || undefined,
    });
  }
  const parsed = result.data;
  // SPEC-005: from here on the request is in AI SDK terms; shape errors surface as 400 with a path.
  const { tools, toolChoice } = translateTools(parsed.tools, parsed.tool_choice);
  return {
    request: {
      model: parsed.model,
      continuationRoute,
      messages: translateMessages(parsed.messages),
      params: toParams(parsed),
      tools,
      toolChoice,
      parallelToolCalls: parsed.parallel_tool_calls ?? undefined,
      responseFormat: translateResponseFormat(parsed.response_format),
      endUser: parsed.user ?? undefined,
    },
    stream: parsed.stream ?? false,
    includeUsage: parsed.stream_options?.include_usage ?? false,
  };
}
