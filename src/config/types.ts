export type LlmFallbackConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      provider: string;
      apiMode: 'responses' | 'chat_completions';
      apiKey: string;
      baseUrl: string;
      model: string;
      temperature: number;
      maxTokens: number;
      reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      supportsWebSearch: boolean;
      webSearch: {
        mode: 'openai_tool' | 'openrouter_server_tool' | 'openrouter_online_legacy' | 'none';
        maxResults: number;
        requireCitations: boolean;
      };
    };

export type ResolvedConfig = {
  app: {
    environment: string;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  telegram: {
    mode: 'polling' | 'webhook';
    allowedChatId: string;
    adminUserId: string;
    typingIndicator: {
      enabled: boolean;
      intervalMs: number;
    };
    webhook: {
      publicUrl: string | null;
      path: string;
      secretToken?: string;
    };
  };
  http: {
    enabled: boolean;
    host: string;
    port: number;
    healthPath: string;
  };
  storage: {
    type: 'sqlite';
    databasePath: string;
  };
  systemPrompt: {
    file: string;
  };
  characters: {
    directory: string;
    default: string;
    selected: string;
    hotReload: boolean;
    fallback: boolean;
  };
  llm: {
    provider: string;
    apiMode: 'responses' | 'chat_completions';
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    supportsWebSearch: boolean;
    webSearch: {
      mode: 'openai_tool' | 'openrouter_server_tool' | 'openrouter_online_legacy' | 'none';
      maxResults: number;
      requireCitations: boolean;
    };
    fallback: LlmFallbackConfig;
  };
  firecrawl: {
    apiKey?: string;
    baseUrl: string;
  };
  providers: Record<
    string,
    {
      type: 'openai-compatible';
      supportsResponsesApi: boolean | 'unknown';
      supportsChatCompletionsApi: boolean | 'unknown';
      supportsReasoningEffort: boolean | 'provider-dependent';
      webSearchMode: 'openai_tool' | 'openrouter_server_tool' | 'openrouter_online_legacy' | 'none';
      legacyOnlineSuffix?: boolean;
    }
  >;
  guardrails: {
    enabled: boolean;
    failOpenOnProviderError: boolean;
    provider: string;
    apiKey?: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    refusalMessage: string;
    checkInput: boolean;
    checkOutput: boolean;
    blockPromptInjection: boolean;
  };
  rateLimit: {
    enabled: boolean;
    perUser: {
      windowMs: number;
      maxRequests: number;
    };
    perChat: {
      windowMs: number;
      maxRequests: number;
    };
  };
  queue: {
    enabled: boolean;
    maxConcurrentRequests: number;
    maxQueueSize: number;
    timeoutMs: number;
  };
  timeouts: {
    llmRequestMs: number;
    telegramSendMs: number;
  };
  commands: {
    registerOnStartup: boolean;
    group: Array<{ command: string; description: string }>;
    adminPrivate: Array<{ command: string; description: string }>;
  };
  logging: {
    sqlite: {
      enabled: boolean;
      logMessages: boolean;
      redactSecrets: boolean;
    };
  };
  messages: {
    unsupportedReply: string;
    rateLimitExceeded: string;
    queueTimeout: string;
    queueFull: string;
    llmError: string;
    greetUser: string;
    helpText: string;
    helpSearchHint: string;
    searchEmptyArgs: string;
    personasAvailable: string;
    personasEmpty: string;
    personaMissingName: string;
    personaUnknown: string;
    personaChanged: string;
    statusTitle: string;
  };
  secrets: {
    telegramBotToken: string;
  };
};
