import { z } from 'zod';

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export const telegramModeSchema = z.enum(['polling', 'webhook']);
export const apiModeSchema = z.enum(['responses', 'chat_completions']);
export const reasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
export const providerTypeSchema = z.literal('openai-compatible');
export const triStateSchema = z.union([z.boolean(), z.literal('unknown')]);
export const webSearchModeSchema = z.enum([
  'openai_tool',
  'openrouter_server_tool',
  'openrouter_online_legacy',
  'none',
]);

export const rawConfigSchema = z.object({
  app: z.object({
    environment: z.string().min(1),
    logLevel: logLevelSchema,
  }),
  telegram: z.object({
    mode: telegramModeSchema,
    allowedChatIdEnv: z.string().min(1),
    adminUserIdEnv: z.string().min(1),
    typingIndicator: z.object({
      enabled: z.boolean(),
      intervalMs: z.number().int().positive(),
    }),
    webhook: z.object({
      publicUrl: z.union([z.string().url(), z.null()]),
      path: z.string().min(1),
      secretTokenEnv: z.string().min(1),
    }),
  }),
  http: z.object({
    enabled: z.boolean(),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    healthPath: z.string().min(1),
  }),
  storage: z.object({
    type: z.literal('sqlite'),
    databasePathEnv: z.string().min(1),
  }),
  systemPrompt: z.object({
    file: z.string().min(1),
  }),
  characters: z.object({
    directory: z.string().min(1),
    default: z.string().min(1),
    selected: z.string().min(1),
    hotReload: z.boolean(),
  }),
  llm: z.object({
    provider: z.string().min(1),
    apiMode: apiModeSchema,
    apiKeyEnv: z.string().min(1),
    baseUrl: z.string().url(),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
    reasoningEffort: reasoningEffortSchema,
    supportsWebSearch: z.boolean(),
    webSearch: z.object({
      mode: webSearchModeSchema,
      maxResults: z.number().int().positive(),
      requireCitations: z.boolean(),
    }),
  }),
  providers: z.record(
    z.string().min(1),
    z.object({
      type: providerTypeSchema,
      supportsResponsesApi: triStateSchema,
      supportsChatCompletionsApi: triStateSchema,
      supportsReasoningEffort: z.union([z.boolean(), z.literal('provider-dependent')]),
      webSearchMode: webSearchModeSchema,
      legacyOnlineSuffix: z.boolean().optional(),
    }),
  ),
  guardrails: z.object({
    enabled: z.boolean(),
    failOpenOnProviderError: z.boolean(),
    provider: z.string().min(1),
    apiKeyEnv: z.string().min(1),
    baseUrl: z.string().url(),
    model: z.string().min(1),
    timeoutMs: z.number().int().positive(),
    refusalMessage: z.string().min(1),
    checkInput: z.boolean(),
    checkOutput: z.boolean(),
    blockPromptInjection: z.boolean(),
  }),
  rateLimit: z.object({
    enabled: z.boolean(),
    perUser: z.object({
      windowMs: z.number().int().positive(),
      maxRequests: z.number().int().positive(),
    }),
    perChat: z.object({
      windowMs: z.number().int().positive(),
      maxRequests: z.number().int().positive(),
    }),
  }),
  queue: z.object({
    enabled: z.boolean(),
    maxConcurrentRequests: z.number().int().positive(),
    maxQueueSize: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
  }),
  timeouts: z.object({
    llmRequestMs: z.number().int().positive(),
    telegramSendMs: z.number().int().positive(),
  }),
  commands: z.object({
    registerOnStartup: z.boolean(),
    group: z.array(
      z.object({
        command: z.string().min(1),
        description: z.string().min(1),
      }),
    ),
    adminPrivate: z.array(
      z.object({
        command: z.string().min(1),
        description: z.string().min(1),
      }),
    ),
  }),
  logging: z.object({
    sqlite: z.object({
      enabled: z.boolean(),
      logMessages: z.boolean(),
      redactSecrets: z.boolean(),
    }),
  }),
  messages: z.object({
    unsupportedReply: z.string().min(1),
    rateLimitExceeded: z.string().min(1),
    queueTimeout: z.string().min(1),
    queueFull: z.string().min(1),
    llmError: z.string().min(1),
    helpText: z.string().min(1),
    helpSearchHint: z.string().min(1),
    searchEmptyArgs: z.string().min(1),
    personasAvailable: z.string().min(1),
    personasEmpty: z.string().min(1),
    personaMissingName: z.string().min(1),
    personaUnknown: z.string().min(1),
    personaChanged: z.string().min(1),
    statusTitle: z.string().min(1),
  }),
});

export type RawConfig = z.infer<typeof rawConfigSchema>;
