import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { type CreateAppOptions, createApp } from '../src/app.js';
import type { ResolvedConfig } from '../src/config/types.js';

function createMockConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    app: { environment: 'test', logLevel: 'info' },
    telegram: {
      mode: 'polling',
      allowedChatId: '-100123',
      adminUserId: '12345',
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
      enabled: false,
      failOpenOnProviderError: true,
      provider: 'openai',
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
      adminPrivate: [{ command: 'status', description: 'Status' }],
    },
    logging: { sqlite: { enabled: true, logMessages: false, redactSecrets: true } },
    secrets: { telegramBotToken: 'test-token' },
    ...overrides,
  } as ResolvedConfig;
}

describe('createApp', () => {
  it('returns an app with start and stop methods', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.start).toBe('function');
    expect(typeof app.stop).toBe('function');
  });

  it('composes and starts services in polling mode', async () => {
    const mockConfig = createMockConfig({
      telegram: { ...createMockConfig().telegram, mode: 'polling' },
    });
    const mockDb = {
      close: vi.fn(),
      prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({ '1': 1 }) }),
    } as unknown as import('better-sqlite3').Database;

    const mockBot = {
      botUsername: 'testbot',
      botId: 123,
      api: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendChatAction: vi.fn().mockResolvedValue(undefined),
      },
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const mockHealthServer = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      server: { address: vi.fn().mockReturnValue({ port: 9999 }) } as unknown as Server,
    };

    const options: CreateAppOptions = {
      overrides: {
        loadConfig: vi.fn().mockReturnValue(mockConfig),
        createDatabase: vi.fn().mockReturnValue(mockDb),
        createLogger: vi.fn().mockReturnValue({
          logBotEvent: vi.fn(),
          logGuardrailEvent: vi.fn(),
          logConsoleEvent: vi.fn(),
        }),
        createCharacterStore: vi.fn().mockReturnValue({
          getCurrentCharacter: vi.fn().mockReturnValue({ name: 'default', content: 'Friendly' }),
          listCharacters: vi.fn().mockReturnValue(['default']),
          selectCharacter: vi.fn().mockReturnValue(true),
        }),
        createRateLimiter: vi
          .fn()
          .mockReturnValue({ check: vi.fn().mockReturnValue({ allowed: true }) }),
        createRequestQueue: vi.fn().mockReturnValue({
          enqueue: vi.fn().mockImplementation(async (task: () => Promise<unknown>) => {
            try {
              const value = await task();
              return { ok: true as const, value };
            } catch {
              return { ok: false as const, reason: 'error' as const };
            }
          }),
        }),
        createGuardrailsService: vi
          .fn()
          .mockReturnValue({ check: vi.fn().mockResolvedValue({ allowed: true }) }),
        createBot: vi.fn().mockResolvedValue(mockBot),
        createHealthServer: vi.fn().mockReturnValue(mockHealthServer),
        readSystemPrompt: vi.fn().mockReturnValue('System prompt'),
      },
    };

    const app = createApp(options);
    await app.start();

    expect(options.overrides?.loadConfig).toHaveBeenCalled();
    expect(options.overrides?.createDatabase).toHaveBeenCalledWith(mockConfig.storage.databasePath);
    expect(options.overrides?.createBot).toHaveBeenCalled();
    expect(mockBot.start).toHaveBeenCalled();
    expect(mockHealthServer.start).toHaveBeenCalled();

    await app.stop();
    expect(mockBot.stop).toHaveBeenCalled();
    expect(mockHealthServer.stop).toHaveBeenCalled();
    expect(mockDb.close).toHaveBeenCalled();
  });

  it('does not start health server when http is disabled', async () => {
    const mockConfig = createMockConfig({ http: { ...createMockConfig().http, enabled: false } });
    const mockDb = {
      close: vi.fn(),
      prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({ '1': 1 }) }),
    } as unknown as import('better-sqlite3').Database;

    const mockBot = {
      botUsername: 'testbot',
      botId: 123,
      api: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendChatAction: vi.fn().mockResolvedValue(undefined),
      },
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const mockHealthServer = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      server: { address: vi.fn().mockReturnValue({ port: 9999 }) } as unknown as Server,
    };

    const options: CreateAppOptions = {
      overrides: {
        loadConfig: vi.fn().mockReturnValue(mockConfig),
        createDatabase: vi.fn().mockReturnValue(mockDb),
        createLogger: vi.fn().mockReturnValue({
          logBotEvent: vi.fn(),
          logGuardrailEvent: vi.fn(),
          logConsoleEvent: vi.fn(),
        }),
        createCharacterStore: vi.fn().mockReturnValue({
          getCurrentCharacter: vi.fn().mockReturnValue({ name: 'default', content: 'Friendly' }),
          listCharacters: vi.fn().mockReturnValue(['default']),
          selectCharacter: vi.fn().mockReturnValue(true),
        }),
        createRateLimiter: vi
          .fn()
          .mockReturnValue({ check: vi.fn().mockReturnValue({ allowed: true }) }),
        createRequestQueue: vi.fn().mockReturnValue({
          enqueue: vi.fn().mockImplementation(async (task: () => Promise<unknown>) => {
            try {
              const value = await task();
              return { ok: true as const, value };
            } catch {
              return { ok: false as const, reason: 'error' as const };
            }
          }),
        }),
        createGuardrailsService: vi
          .fn()
          .mockReturnValue({ check: vi.fn().mockResolvedValue({ allowed: true }) }),
        createBot: vi.fn().mockResolvedValue(mockBot),
        createHealthServer: vi.fn().mockReturnValue(mockHealthServer),
        readSystemPrompt: vi.fn().mockReturnValue('System prompt'),
      },
    };

    const app = createApp(options);
    await app.start();

    expect(mockHealthServer.start).not.toHaveBeenCalled();

    await app.stop();
    expect(mockHealthServer.stop).not.toHaveBeenCalled();
  });

  it('propagates startup errors from config loading', async () => {
    const options: CreateAppOptions = {
      overrides: {
        loadConfig: vi.fn().mockImplementation(() => {
          throw new Error('Config error');
        }),
      },
    };

    const app = createApp(options);
    await expect(app.start()).rejects.toThrow('Config error');
  });

  it('logs startup errors after SQLite logger is available', async () => {
    const mockConfig = createMockConfig({ http: { ...createMockConfig().http, enabled: false } });
    const mockDb = {
      close: vi.fn(),
      prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({ '1': 1 }) }),
    } as unknown as import('better-sqlite3').Database;
    const logConsoleEvent = vi.fn();
    const mockBot = {
      botUsername: 'testbot',
      botId: 123,
      api: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendChatAction: vi.fn().mockResolvedValue(undefined),
      },
      start: vi.fn().mockRejectedValue(new Error('Polling failed')),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const options: CreateAppOptions = {
      overrides: {
        loadConfig: vi.fn().mockReturnValue(mockConfig),
        createDatabase: vi.fn().mockReturnValue(mockDb),
        createLogger: vi.fn().mockReturnValue({
          logBotEvent: vi.fn(),
          logGuardrailEvent: vi.fn(),
          logConsoleEvent,
        }),
        createCharacterStore: vi.fn().mockReturnValue({
          getCurrentCharacter: vi.fn().mockReturnValue({ name: 'default', content: 'Friendly' }),
          listCharacters: vi.fn().mockReturnValue(['default']),
          selectCharacter: vi.fn().mockReturnValue(true),
        }),
        createRateLimiter: vi
          .fn()
          .mockReturnValue({ check: vi.fn().mockReturnValue({ allowed: true }) }),
        createRequestQueue: vi.fn().mockReturnValue({
          enqueue: vi.fn().mockImplementation(async (task: () => Promise<unknown>) => {
            try {
              const value = await task();
              return { ok: true as const, value };
            } catch {
              return { ok: false as const, reason: 'error' as const };
            }
          }),
        }),
        createGuardrailsService: vi
          .fn()
          .mockReturnValue({ check: vi.fn().mockResolvedValue({ allowed: true }) }),
        createBot: vi.fn().mockResolvedValue(mockBot),
        readSystemPrompt: vi.fn().mockReturnValue('System prompt'),
      },
    };

    const app = createApp(options);
    await expect(app.start()).rejects.toThrow('Polling failed');

    expect(logConsoleEvent).toHaveBeenCalledWith({
      level: 'error',
      type: 'startup_error',
      message: 'Polling failed',
    });
  });
});
