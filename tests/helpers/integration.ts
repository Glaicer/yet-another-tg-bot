import type Database from 'better-sqlite3';
import type { Update } from 'grammy/types';
import { vi } from 'vitest';
import { type CreateAppOptions, createApp } from '../../src/app.js';
import type { ResolvedConfig } from '../../src/config/types.js';
import type { HealthServer } from '../../src/http/health.js';
import type { BotInstance } from '../../src/telegram/bot.js';

export const ALLOWED_CHAT_ID = -1001234567890;
export const ADMIN_USER_ID = 99999;
export const BOT_USERNAME = 'testbot';
export const BOT_ID = 123;
export const REGULAR_USER_ID = 111;

export function createMockConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    app: { environment: 'test', logLevel: 'info' },
    telegram: {
      mode: 'polling',
      allowedChatId: String(ALLOWED_CHAT_ID),
      adminUserId: String(ADMIN_USER_ID),
      typingIndicator: { enabled: true, intervalMs: 4500 },
      webhook: { publicUrl: null, path: '/webhook' },
    },
    http: { enabled: true, host: '127.0.0.1', port: 0, healthPath: '/healthz' },
    storage: { type: 'sqlite', databasePath: ':memory:' },
    systemPrompt: { file: '/dev/null/system.md' },
    characters: {
      directory: '/dev/null/chars',
      default: 'default',
      selected: 'default',
      hotReload: false,
      fallback: false,
    },
    llm: {
      provider: 'openai',
      apiMode: 'responses',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 800,
      reasoningEffort: 'none',
      supportsWebSearch: true,
      webSearch: { mode: 'openai_tool', maxResults: 5, requireCitations: true },
    },
    providers: {
      openai: {
        type: 'openai-compatible',
        supportsResponsesApi: true,
        supportsChatCompletionsApi: true,
        supportsReasoningEffort: true,
        webSearchMode: 'openai_tool',
      },
    },
    guardrails: {
      enabled: true,
      failOpenOnProviderError: true,
      provider: 'openai',
      apiKey: 'guard-test',
      baseUrl: 'https://guard.example.com/v1',
      model: 'guard',
      timeoutMs: 8000,
      refusalMessage: "Can't help",
      checkInput: true,
      checkOutput: false,
      blockPromptInjection: true,
    },
    rateLimit: {
      enabled: false,
      perUser: { windowMs: 60000, maxRequests: 5 },
      perChat: { windowMs: 60000, maxRequests: 20 },
    },
    queue: { enabled: false, maxConcurrentRequests: 2, maxQueueSize: 20, timeoutMs: 60000 },
    timeouts: { llmRequestMs: 60000, telegramSendMs: 10000 },
    commands: {
      registerOnStartup: true,
      group: [
        { command: 'help', description: 'Help' },
        { command: 'search', description: 'Search' },
      ],
      adminPrivate: [
        { command: 'status', description: 'Status' },
        { command: 'personas', description: 'List personas' },
        { command: 'persona', description: 'Select persona' },
      ],
    },
    logging: { sqlite: { enabled: true, logMessages: false, redactSecrets: true } },
    messages: {
      unsupportedReply: 'I can only work with text messages for now.',
      rateLimitExceeded: 'Rate limit exceeded. Please try again later.',
      queueTimeout: 'Request timed out. Please try again later.',
      queueFull: 'The bot is too busy. Please try again later.',
      llmError: 'Sorry, I encountered an error. Please try again later.',
      helpText:
        "How to use this bot:\n\n• Mention me with @username to ask a question\n• Reply to one of my messages without a mention\n• Reply to another user's text message while mentioning me to include their message in context",
      helpSearchHint: '• Use /search <instruction> to search the web',
      searchEmptyArgs: 'Please provide a search instruction: /search <instruction>',
      personasAvailable: 'Available personas:\n\n{list}',
      personasEmpty: 'No personas available.',
      personaMissingName: 'Please provide a persona name: /persona <name>',
      personaUnknown: 'Unknown persona: {name}. Use /personas to see available personas.',
      personaChanged: 'Persona changed to: {name}',
      statusTitle: 'Status',
    },
    secrets: { telegramBotToken: 'test-token' },
    ...overrides,
  } as ResolvedConfig;
}

export type CapturedDeps = {
  handleUpdate?: (update: Update) => Promise<void>;
};

export async function setupApp(options?: {
  configOverrides?: Partial<ResolvedConfig>;
  callLlm?: (...args: unknown[]) => Promise<unknown>;
  characterStoreOverrides?: {
    listCharacters?: string[];
    selectCharacterResult?: boolean;
  };
}) {
  const mockConfig = createMockConfig(options?.configOverrides);

  const { createDatabase } = await import('../../src/storage/database.js');
  const { createRateLimiter } = await import('../../src/core/rateLimiter.js');
  const { createRequestQueue } = await import('../../src/core/requestQueue.js');

  const mockDb = createDatabase(':memory:');

  const sendMessageMock = vi.fn().mockResolvedValue(undefined);
  const sendChatActionMock = vi.fn().mockResolvedValue(undefined);

  const mockBot: BotInstance = {
    grammYBot: {},
    botUsername: BOT_USERNAME,
    botId: BOT_ID,
    api: {
      sendMessage: sendMessageMock,
      sendChatAction: sendChatActionMock,
    },
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  const mockHealthServer: HealthServer = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    server: { address: () => ({ port: 9999 }) } as import('node:http').Server,
  };

  const logBotEventMock = vi.fn();
  const logGuardrailEventMock = vi.fn();

  const captured: CapturedDeps = {};

  const appOptions: CreateAppOptions = {
    overrides: {
      loadConfig: vi.fn().mockReturnValue(mockConfig),
      createDatabase: vi.fn().mockReturnValue(mockDb),
      createLogger: vi.fn().mockReturnValue({
        logBotEvent: logBotEventMock,
        logGuardrailEvent: logGuardrailEventMock,
      }),
      createCharacterStore: vi.fn().mockImplementation((opts) => {
        const list = options?.characterStoreOverrides?.listCharacters ?? ['default', 'sassy'];
        const currentName = 'default';
        return {
          getCurrentCharacter: () => ({ name: currentName, content: 'Friendly bot' }),
          listCharacters: () => list,
          selectCharacter: (name: string) => {
            if (list.includes(name)) {
              mockDb
                .prepare(
                  'INSERT INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
                )
                .run('selected_character', name, new Date().toISOString());
              return true;
            }
            return false;
          },
        };
      }),
      createRateLimiter: vi.fn().mockImplementation((config) => createRateLimiter(config)),
      createRequestQueue: vi.fn().mockImplementation((config) => createRequestQueue(config)),
      createGuardrailsService: vi.fn().mockImplementation(async (config, logger, callLlmFn) => {
        const { createGuardrailsService } = await import(
          '../../src/guardrails/guardrailsService.js'
        );
        return createGuardrailsService(config, logger, callLlmFn);
      }),
      createBot: vi.fn().mockImplementation(async (deps) => {
        captured.handleUpdate = deps.handleUpdate;
        return mockBot;
      }),
      createHealthServer: vi.fn().mockReturnValue(mockHealthServer),
      readSystemPrompt: vi.fn().mockReturnValue('You are a helpful assistant.'),
      callLlm: (options?.callLlm as never) ?? vi.fn().mockResolvedValue({ text: 'Mock response' }),
    },
  };

  const app = createApp(appOptions);
  await app.start();

  return {
    app,
    mockDb,
    mockBot,
    mockHealthServer,
    sendMessage: sendMessageMock,
    sendChatAction: sendChatActionMock,
    logBotEvent: logBotEventMock,
    logGuardrailEvent: logGuardrailEventMock,
    captured,
    config: mockConfig,
  };
}

export function makeGroupMessage(overrides: {
  chatId?: number;
  userId?: number;
  threadId?: number;
  text?: string;
  replyToMessage?: {
    message_id: number;
    from?: { id: number; username?: string };
    text?: string;
    photo?: unknown[];
  };
}): Update {
  const chatId = overrides.chatId ?? ALLOWED_CHAT_ID;
  const userId = overrides.userId ?? REGULAR_USER_ID;

  const message: Record<string, unknown> = {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: {
      id: chatId,
      type: chatId > 0 ? 'private' : 'supergroup',
      title: 'Test Group',
    },
    from: {
      id: userId,
      is_bot: false,
      first_name: 'Test',
    },
    text: overrides.text ?? 'Hello bot',
  };

  if (overrides.threadId !== undefined) {
    message.message_thread_id = overrides.threadId;
  }

  if (overrides.replyToMessage) {
    message.reply_to_message = overrides.replyToMessage;
  }

  return { update_id: 1, message: message as never };
}

export function makePrivateMessage(overrides: {
  userId?: number;
  text?: string;
}): Update {
  const userId = overrides.userId ?? ADMIN_USER_ID;

  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: userId,
        type: 'private',
      },
      from: {
        id: userId,
        is_bot: false,
        first_name: 'Admin',
      },
      text: overrides.text ?? '/status',
    } as never,
  };
}
