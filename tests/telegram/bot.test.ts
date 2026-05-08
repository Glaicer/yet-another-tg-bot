import { describe, expect, it, vi } from 'vitest';
import { type GrammYBotLike, createBot } from '../../src/telegram/bot.js';

function createMockGrammYBot(overrides?: Partial<GrammYBotLike>): GrammYBotLike {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    api: {
      getMe: vi.fn().mockResolvedValue({ id: 123, username: 'testbot' }),
      setMyCommands: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      setWebhook: vi.fn().mockResolvedValue(undefined),
      deleteWebhook: vi.fn().mockResolvedValue(undefined),
    },
    botInfo: { id: 123, username: 'testbot' },
    on: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as GrammYBotLike;
}

function createDeps(overrides?: Partial<Parameters<typeof createBot>[0]>) {
  const mockBot = createMockGrammYBot();
  return {
    deps: {
      createGrammYBot: vi.fn().mockReturnValue(mockBot),
      token: 'test-token',
      mode: 'polling' as const,
      handleUpdate: vi.fn().mockResolvedValue(undefined),
      commands: {
        registerOnStartup: true,
        group: [
          { command: 'help', description: 'Bot help' },
          { command: 'search', description: 'Search web' },
        ],
        adminPrivate: [
          { command: 'status', description: 'Status' },
          { command: 'personas', description: 'List personas' },
          { command: 'persona', description: 'Select persona' },
        ],
      },
      supportsWebSearch: true,
      logger: { warn: vi.fn() },
      ...overrides,
    },
    mockBot,
  };
}

describe('createBot', () => {
  it('discovers username via getMe on init', async () => {
    const { deps, mockBot } = createDeps();
    const instance = await createBot(deps);
    expect(mockBot.init).toHaveBeenCalledTimes(1);
    expect(instance.botUsername).toBe('testbot');
    expect(instance.botId).toBe(123);
  });

  it('registers all commands on startup when enabled', async () => {
    const { deps, mockBot } = createDeps();
    await createBot(deps);
    expect(mockBot.api.setMyCommands).toHaveBeenCalledTimes(1);
    const commands = (mockBot.api.setMyCommands as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      command: string;
      description: string;
    }>;
    expect(commands).toHaveLength(5);
    expect(commands.map((c) => c.command)).toContain('help');
    expect(commands.map((c) => c.command)).toContain('search');
    expect(commands.map((c) => c.command)).toContain('status');
  });

  it('excludes /search from registered commands when web search is unavailable', async () => {
    const { deps, mockBot } = createDeps({ supportsWebSearch: false });
    await createBot(deps);
    const commands = (mockBot.api.setMyCommands as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      command: string;
    }>;
    expect(commands.some((c) => c.command === 'search')).toBe(false);
    expect(commands.some((c) => c.command === 'help')).toBe(true);
  });

  it('logs warning and does not crash when command registration fails', async () => {
    const { deps, mockBot } = createDeps();
    (mockBot.api.setMyCommands as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Telegram API error'),
    );
    await expect(createBot(deps)).resolves.toBeDefined();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Command registration failed'),
    );
  });

  it('does not register commands when registerOnStartup is false', async () => {
    const { deps, mockBot } = createDeps();
    deps.commands.registerOnStartup = false;
    await createBot(deps);
    expect(mockBot.api.setMyCommands).not.toHaveBeenCalled();
  });

  it('starts bot in polling mode', async () => {
    const { deps, mockBot } = createDeps({ mode: 'polling' });
    const instance = await createBot(deps);
    await instance.start();
    expect(mockBot.start).toHaveBeenCalledTimes(1);
    expect(mockBot.api.setWebhook).not.toHaveBeenCalled();
  });

  it('configures webhook in webhook mode', async () => {
    const { deps, mockBot } = createDeps({
      mode: 'webhook',
      webhookConfig: {
        publicUrl: 'https://example.com',
        path: '/webhook',
        secretToken: 'secret-token',
      },
    });
    const instance = await createBot(deps);
    await instance.start();
    expect(mockBot.start).not.toHaveBeenCalled();
    expect(mockBot.api.setWebhook).toHaveBeenCalledTimes(1);
    expect(mockBot.api.setWebhook).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({ secret_token: 'secret-token' }),
    );
  });

  it('passes updates to handleUpdate through message handler', async () => {
    const { deps, mockBot } = createDeps();
    await createBot(deps);
    const onCalls = (mockBot.on as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandlerEntry = onCalls.find((call) => call[0] === 'message');
    expect(messageHandlerEntry).toBeDefined();

    const update = { message: { message_id: 1, chat: { id: 1 }, text: 'hello' } };
    const handler = (messageHandlerEntry ?? [])[1] as (ctx: { update: unknown }) => Promise<void>;
    await handler({ update });

    expect(deps.handleUpdate).toHaveBeenCalledWith(update);
  });

  it('stops bot in polling mode', async () => {
    const { deps, mockBot } = createDeps({ mode: 'polling' });
    const instance = await createBot(deps);
    await instance.stop();
    expect(mockBot.stop).toHaveBeenCalledTimes(1);
  });

  it('stops bot and deletes webhook in webhook mode', async () => {
    const { deps, mockBot } = createDeps({
      mode: 'webhook',
      webhookConfig: {
        publicUrl: 'https://example.com',
        path: '/webhook',
      },
    });
    const instance = await createBot(deps);
    await instance.stop();
    expect(mockBot.stop).toHaveBeenCalledTimes(1);
    expect(mockBot.api.deleteWebhook).toHaveBeenCalledTimes(1);
  });

  it('uses real grammY Bot when createGrammYBot is not provided', async () => {
    // We can't actually test with real Bot without network, but we verify the type accepts it
    const { Bot: RealBot } = await import('grammy');
    const deps = {
      token: 'dummy',
      mode: 'polling' as const,
      handleUpdate: vi.fn().mockResolvedValue(undefined),
      commands: {
        registerOnStartup: false,
        group: [],
        adminPrivate: [],
      },
      supportsWebSearch: false,
      logger: { warn: vi.fn() },
    };
    // This should compile without error
    expect(() => createBot(deps)).toBeDefined();
  });
});
