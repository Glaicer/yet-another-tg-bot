import { describe, expect, it, vi } from 'vitest';
import {
  type CommandDeps,
  handleAdminCommand,
  handleGroupCommand,
} from '../../src/telegram/commands.js';

function createMockDeps(): CommandDeps {
  const messages = {
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
  };

  return {
    config: {
      llm: {
        provider: 'openai',
        model: 'gpt-4',
        apiMode: 'responses',
        supportsWebSearch: true,
        temperature: 0.7,
        maxTokens: 800,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        reasoningEffort: 'none',
        webSearch: {
          mode: 'openai_tool',
          maxResults: 5,
          requireCitations: true,
        },
      },
      timeouts: {
        llmRequestMs: 5000,
      },
      telegram: {
        mode: 'polling',
      },
      guardrails: {
        enabled: true,
      },
      storage: {
        databasePath: '/app/data/bot.db',
      },
      messages,
    } as CommandDeps['config'],
    characterStore: {
      getCurrentCharacter: vi.fn().mockReturnValue({ name: 'default', content: 'Friendly bot' }),
      listCharacters: vi.fn().mockReturnValue(['default', 'sassy', 'formal']),
      selectCharacter: vi.fn().mockReturnValue(true),
    },
    sendSafeMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({}),
      sendChatAction: vi.fn().mockResolvedValue({}),
    },
    logger: {
      logBotEvent: vi.fn(),
      logGuardrailEvent: vi.fn(),
      logConsoleEvent: vi.fn(),
    },
    getUptimeSeconds: vi.fn().mockReturnValue(3665),
    buildPrompt: vi.fn().mockReturnValue([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User request' },
    ]),
    mapLlmRequest: vi.fn().mockReturnValue({
      url: 'https://api.test.com/v1/responses',
      headers: { Authorization: 'Bearer test' },
      body: { model: 'gpt-4', input: [] },
    }),
    callLlm: vi.fn().mockResolvedValue({ text: 'Search result' }),
    startTypingIndicator: vi.fn().mockReturnValue({ stop: vi.fn() }),
    guardrails: {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    },
    rateLimiter: {
      check: vi.fn().mockReturnValue({ allowed: true }),
    },
    requestQueue: {
      enqueue: vi.fn().mockImplementation(async (task: () => Promise<unknown>) => {
        try {
          const value = await task();
          return { ok: true as const, value };
        } catch {
          return { ok: false as const, reason: 'error' as const };
        }
      }),
    },
    systemPrompt: 'You are a helpful assistant.',
  } as unknown as CommandDeps;
}

describe('handleGroupCommand', () => {
  it('sends help text for /help', async () => {
    const deps = createMockDeps();
    const event = {
      type: 'group_command' as const,
      chatId: -100123,
      threadId: 7,
      userId: 111,
      command: 'help',
      args: '',
    };

    await handleGroupCommand(deps, event);

    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -100123,
      expect.stringContaining('Mention me with @username'),
      { threadId: 7 },
    );
    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command_help', chatId: '-100123', userId: '111' }),
    );
  });

  it('includes /search hint in help when web search is available', async () => {
    const deps = createMockDeps();
    deps.config.llm.supportsWebSearch = true;
    const event = {
      type: 'group_command' as const,
      chatId: -100123,
      threadId: undefined,
      userId: 111,
      command: 'help',
      args: '',
    };

    await handleGroupCommand(deps, event);

    const sentText = deps.sendSafeMessage.mock.calls[0][2];
    expect(sentText).toContain('/search');
  });

  it('excludes /search hint in help when web search is unavailable', async () => {
    const deps = createMockDeps();
    deps.config.llm.supportsWebSearch = false;
    const event = {
      type: 'group_command' as const,
      chatId: -100123,
      threadId: undefined,
      userId: 111,
      command: 'help',
      args: '',
    };

    await handleGroupCommand(deps, event);

    const sentText = deps.sendSafeMessage.mock.calls[0][2];
    expect(sentText).not.toContain('/search');
  });

  it('dispatches search command to handleSearch', async () => {
    const deps = createMockDeps();
    const event = {
      type: 'group_command' as const,
      chatId: -100123,
      threadId: undefined,
      userId: 111,
      command: 'search',
      args: 'what is the weather',
    };

    await handleGroupCommand(deps, event);

    expect(deps.startTypingIndicator).toHaveBeenCalledTimes(1);
    expect(deps.callLlm).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalled();
  });

  it('does nothing for search when web search is not supported', async () => {
    const deps = createMockDeps();
    deps.config.llm.supportsWebSearch = false;
    const event = {
      type: 'group_command' as const,
      chatId: -100123,
      threadId: undefined,
      userId: 111,
      command: 'search',
      args: 'what is the weather',
    };

    await handleGroupCommand(deps, event);

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
    expect(deps.logger.logBotEvent).not.toHaveBeenCalled();
  });

  it('does nothing for unknown group commands', async () => {
    const deps = createMockDeps();
    const event = {
      type: 'group_command' as const,
      chatId: -100123,
      userId: 111,
      command: 'unknown',
      args: '',
    };

    await handleGroupCommand(deps, event);

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
    expect(deps.logger.logBotEvent).not.toHaveBeenCalled();
  });
});

describe('handleAdminCommand', () => {
  it('sends status for /status', async () => {
    const deps = createMockDeps();
    const event = {
      type: 'admin_command' as const,
      chatId: 12345,
      userId: 12345,
      command: 'status',
      args: '',
    };

    await handleAdminCommand(deps, event);

    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      12345,
      expect.stringContaining('Provider: openai'),
    );
    const sentText = deps.sendSafeMessage.mock.calls[0][2];
    expect(sentText).toContain('Model: gpt-4');
    expect(sentText).toContain('API mode: responses');
    expect(sentText).toContain('Character: default');
    expect(sentText).toContain('Guardrails: enabled');
    expect(sentText).toContain('Telegram mode: polling');
    expect(sentText).toContain('Web search: available');
    expect(sentText).toContain('SQLite: /app/data/bot.db');
    expect(sentText).toContain('Uptime: 1h 1m 5s');

    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command_status', userId: '12345' }),
    );
  });

  it('status does not contain secrets', async () => {
    const deps = createMockDeps();
    (deps.config.llm as Record<string, unknown>).apiKey = 'sk-secret123';
    (deps.config as Record<string, unknown>).secrets = { telegramBotToken: 'token-secret' };
    const event = {
      type: 'admin_command' as const,
      chatId: 12345,
      userId: 12345,
      command: 'status',
      args: '',
    };

    await handleAdminCommand(deps, event);

    const sentText = deps.sendSafeMessage.mock.calls[0][2];
    expect(sentText).not.toContain('sk-secret123');
    expect(sentText).not.toContain('token-secret');
  });

  it('lists personas for /personas', async () => {
    const deps = createMockDeps();
    const event = {
      type: 'admin_command' as const,
      chatId: 12345,
      userId: 12345,
      command: 'personas',
      args: '',
    };

    await handleAdminCommand(deps, event);

    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    const sentText = deps.sendSafeMessage.mock.calls[0][2];
    expect(sentText).toContain('default');
    expect(sentText).toContain('sassy');
    expect(sentText).toContain('formal');

    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command_personas', userId: '12345' }),
    );
  });

  it('selects persona for /persona <name>', async () => {
    const deps = createMockDeps();
    deps.characterStore.selectCharacter.mockReturnValue(true);
    const event = {
      type: 'admin_command' as const,
      chatId: 12345,
      userId: 12345,
      command: 'persona',
      args: 'sassy',
    };

    await handleAdminCommand(deps, event);

    expect(deps.characterStore.selectCharacter).toHaveBeenCalledWith('sassy');
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      12345,
      'Persona changed to: sassy',
    );
    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'command_persona_selected',
        userId: '12345',
        metadata: { selectedName: 'sassy' },
      }),
    );
  });

  it('rejects unknown persona and retains current', async () => {
    const deps = createMockDeps();
    deps.characterStore.selectCharacter.mockReturnValue(false);
    const event = {
      type: 'admin_command' as const,
      chatId: 12345,
      userId: 12345,
      command: 'persona',
      args: 'nonexistent',
    };

    await handleAdminCommand(deps, event);

    expect(deps.characterStore.selectCharacter).toHaveBeenCalledWith('nonexistent');
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      12345,
      'Unknown persona: nonexistent. Use /personas to see available personas.',
    );
    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'command_persona_rejected',
        userId: '12345',
        metadata: { requestedName: 'nonexistent' },
      }),
    );
  });

  it('prompts for name when /persona has no args', async () => {
    const deps = createMockDeps();
    const event = {
      type: 'admin_command' as const,
      chatId: 12345,
      userId: 12345,
      command: 'persona',
      args: '',
    };

    await handleAdminCommand(deps, event);

    expect(deps.characterStore.selectCharacter).not.toHaveBeenCalled();
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      12345,
      'Please provide a persona name: /persona <name>',
    );
  });

  it('does nothing for unknown admin commands', async () => {
    const deps = createMockDeps();
    const event = {
      type: 'admin_command' as const,
      chatId: 12345,
      userId: 12345,
      command: 'unknown',
      args: '',
    };

    await handleAdminCommand(deps, event);

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
    expect(deps.logger.logBotEvent).not.toHaveBeenCalled();
  });
});
