import { z } from "zod";
import { CAPABILITIES } from "./capabilities.js";

const ParamsSchema = z.strictObject({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.int().positive().optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  seed: z.int().optional(),
  stop: z.array(z.string()).max(4).optional(),
});

const ProviderSchema = z.strictObject({
  type: z.string().min(1),
  apiKeyEnv: z.string().min(1),
  baseURL: z.url({ protocol: /^https$/ }).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  // Validated by the factory's own schema (SPEC-004).
  options: z.record(z.string(), z.unknown()).optional(),
});

const ModelSchema = z.strictObject({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITIES)),
  contextWindow: z.int().positive().optional(),
  maxOutputTokens: z.int().positive().optional(),
  timeoutMs: z.int().positive().default(120000),
  maxRetries: z.int().min(0).max(3).default(1),
  defaults: ParamsSchema.optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
});

const RouteSchema = z.strictObject({
  description: z.string().min(1).max(300),
  target: z.string().min(1),
  fallbacks: z.array(z.string()).default([]),
  defaults: ParamsSchema.optional(),
  enforce: ParamsSchema.optional(),
});

const OrchestratorSchema = z.strictObject({
  model: z.string().min(1),
  fallbacks: z.array(z.string()).default([]),
  defaultRoute: z.string().min(1),
  timeoutMs: z.int().positive().default(5000),
  instructions: z.string().max(2000).optional(),
  context: z
    .strictObject({
      maxMessages: z.int().positive().default(6),
      maxCharsPerMessage: z.int().positive().default(2000),
      maxChars: z.int().positive().default(8000),
    })
    .prefault({}),
});

const AuthKeySchema = z.strictObject({
  id: z.string().min(1),
  keyEnv: z.string().min(1),
  routes: z.array(z.string().min(1)),
});

export const ConfigFileSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.number(),
  server: z
    .strictObject({
      port: z.int().min(1).max(65535).default(8080),
      bodyLimit: z.string().min(1).default("10mb"),
      shutdownGraceMs: z.int().nonnegative().default(30000),
    })
    .prefault({}),
  logging: z
    .strictObject({
      level: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
      includeContent: z.boolean().default(false),
    })
    .prefault({}),
  auth: z.strictObject({ keys: z.array(AuthKeySchema) }),
  providers: z.record(z.string(), ProviderSchema),
  models: z.record(z.string(), ModelSchema),
  orchestrator: OrchestratorSchema,
  routes: z.record(z.string(), RouteSchema),
});

export type ConfigFile = z.output<typeof ConfigFileSchema>;
