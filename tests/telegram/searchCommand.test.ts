import { describe, expect, it, vi } from 'vitest';
import { hashString } from '../../src/core/hash.js';
import type { BotEvent } from '../../src/storage/logger.js';
import { type SearchCommandDeps, handleSearch } from '../../src/telegram/searchCommand.js';
import type { ParsedEvent } from '../../src/telegram/types.js';

function createMockDeps(overrides?: Partial<SearchCommandDeps>): SearchCommandDeps {
  return {
    config: {
      llm: {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 800,
        supportsWebSearch: true,
        apiMode: 'responses',
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
    } as SearchCommandDeps['config'],
    characterStore: {
      getCurrentCharacter: vi.fn().mockReturnValue({ name: 'default', content: 'Friendly bot' }),
    },
    sendSafeMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({}),
      sendChatAction: vi.fn().mockResolvedValue({}),
    },
    logger: {
      logBotEvent: vi.fn(),
      logGuardrailEvent: vi.fn(),
    },
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
    unsupportedReplyText: 'I can only work with text messages for now.',
    rateLimitMessage: 'Rate limit exceeded. Please try again later.',
    queueTimeoutMessage: 'Request timed out. Please try again later.',
    queueFullMessage: 'The bot is too busy. Please try again later.',
    llmErrorMessage: 'Sorry, I encountered an error. Please try again later.',
    ...overrides,
  } as unknown as SearchCommandDeps;
}

function makeSearchEvent(
  overrides: Partial<Extract<ParsedEvent, { type: 'group_command' }>> = {},
): Extract<ParsedEvent, { type: 'group_command' }> {
  return {
    type: 'group_command',
    chatId: -100123,
    threadId: undefined,
    userId: 111,
    command: 'search',
    args: 'what is the weather',
    ...overrides,
  };
}

describe('handleSearch', () => {
  it('does nothing when web search is not supported', async () => {
    const deps = createMockDeps();
    deps.config.llm.supportsWebSearch = false;
    const event = makeSearchEvent();

    await handleSearch(deps, event);

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
    expect(deps.logger.logBotEvent).not.toHaveBeenCalled();
  });

  it('prompts for instruction when args are empty', async () => {
    const deps = createMockDeps();
    const event = makeSearchEvent({ args: '' });

    await handleSearch(deps, event);

    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -100123,
      expect.stringContaining('/search <instruction>'),
      { threadId: undefined },
    );
    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command_search_empty', chatId: '-100123', userId: '111' }),
    );
  });

  it('processes direct /search through full pipeline with webSearch=true', async () => {
    const deps = createMockDeps();
    const event = makeSearchEvent({ args: 'what is the weather' });

    await handleSearch(deps, event);

    expect(deps.rateLimiter.check).toHaveBeenCalledWith('111', '-100123');
    expect(deps.startTypingIndicator).toHaveBeenCalledTimes(1);
    expect(deps.guardrails.check).toHaveBeenCalledWith({
      userText: 'what is the weather',
      repliedText: undefined,
      chatId: '-100123',
      userId: '111',
    });
    expect(deps.buildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: deps.systemPrompt,
        character: 'Friendly bot',
        userText: 'what is the weather',
        repliedText: undefined,
        mode: 'search',
      }),
    );
    expect(deps.mapLlmRequest).toHaveBeenCalledWith(
      deps.config,
      expect.objectContaining({
        webSearch: true,
      }),
    );
    expect(deps.callLlm).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenLastCalledWith(
      { api: deps.api, logger: deps.logger },
      -100123,
      expect.stringContaining('Search result'),
      { threadId: undefined },
    );
    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command_search', chatId: '-100123', userId: '111' }),
    );
  });

  it('includes replied text for reply-to-other /search', async () => {
    const deps = createMockDeps();
    const event = makeSearchEvent({ args: 'explain this', repliedText: 'The sky is blue' });

    await handleSearch(deps, event);

    expect(deps.guardrails.check).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: 'explain this',
        repliedText: 'The sky is blue',
      }),
    );
    expect(deps.buildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: 'explain this',
        repliedText: 'The sky is blue',
        mode: 'search',
      }),
    );
  });

  it('formats response with sources when available', async () => {
    const deps = createMockDeps();
    deps.callLlm.mockResolvedValue({
      text: 'It is sunny today.',
      sources: [
        { title: 'Weather.com', url: 'https://weather.com' },
        { title: 'AccuWeather', url: 'https://accuweather.com' },
      ],
    });
    const event = makeSearchEvent({ args: 'weather' });

    await handleSearch(deps, event);

    const sentText = deps.sendSafeMessage.mock.calls[0][2];
    expect(sentText).toContain('It is sunny today.');
    expect(sentText).toContain('Sources:');
    expect(sentText).toContain('Weather.com');
    expect(sentText).toContain('https://weather.com');
    expect(sentText).toContain('AccuWeather');
    expect(sentText).toContain('https://accuweather.com');
  });

  it('appends no-sources fallback when sources are empty', async () => {
    const deps = createMockDeps();
    deps.callLlm.mockResolvedValue({
      text: 'It might rain.',
      sources: [],
    });
    const event = makeSearchEvent({ args: 'weather' });

    await handleSearch(deps, event);

    const sentText = deps.sendSafeMessage.mock.calls[0][2];
    expect(sentText).toContain('It might rain.');
    expect(sentText).toContain('could not confirm');
  });

  it('appends no-sources fallback when sources are undefined', async () => {
    const deps = createMockDeps();
    deps.callLlm.mockResolvedValue({
      text: 'It might rain.',
    });
    const event = makeSearchEvent({ args: 'weather' });

    await handleSearch(deps, event);

    const sentText = deps.sendSafeMessage.mock.calls[0][2];
    expect(sentText).toContain('It might rain.');
    expect(sentText).toContain('could not confirm');
  });

  it('sends rate limit message when rate limit exceeded', async () => {
    const deps = createMockDeps();
    deps.rateLimiter.check.mockReturnValue({ allowed: false, retryAfterMs: 30000 });
    const event = makeSearchEvent();

    await handleSearch(deps, event);

    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -100123,
      deps.rateLimitMessage,
      { threadId: undefined },
    );
    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rate_limit' }),
    );
  });

  it('blocks before LLM when guardrails disallows', async () => {
    const deps = createMockDeps();
    deps.guardrails.check.mockResolvedValue({ allowed: false, reason: 'Blocked' });
    const event = makeSearchEvent();

    await handleSearch(deps, event);

    expect(deps.buildPrompt).not.toHaveBeenCalled();
    expect(deps.mapLlmRequest).not.toHaveBeenCalled();
    expect(deps.callLlm).not.toHaveBeenCalled();
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -100123,
      'Blocked',
      { threadId: undefined },
    );
  });

  it('sends error message on LLM failure', async () => {
    const deps = createMockDeps();
    deps.callLlm.mockRejectedValue(new Error('LLM request failed: 500'));
    const event = makeSearchEvent();

    await handleSearch(deps, event);

    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -100123,
      deps.llmErrorMessage,
      { threadId: undefined },
    );
    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'llm_error' }),
    );
  });

  it('stops typing indicator after successful response', async () => {
    const deps = createMockDeps();
    const stopTyping = vi.fn();
    deps.startTypingIndicator.mockReturnValue({ stop: stopTyping });
    const event = makeSearchEvent();

    await handleSearch(deps, event);

    expect(stopTyping).toHaveBeenCalledTimes(1);
  });

  it('stops typing indicator after LLM error', async () => {
    const deps = createMockDeps();
    const stopTyping = vi.fn();
    deps.startTypingIndicator.mockReturnValue({ stop: stopTyping });
    deps.callLlm.mockRejectedValue(new Error('fail'));
    const event = makeSearchEvent();

    await handleSearch(deps, event);

    expect(stopTyping).toHaveBeenCalledTimes(1);
  });

  it('sends queue timeout message when queue times out', async () => {
    const deps = createMockDeps();
    deps.requestQueue.enqueue.mockResolvedValue({ ok: false, reason: 'timeout' });
    const event = makeSearchEvent();

    await handleSearch(deps, event);

    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -100123,
      deps.queueTimeoutMessage,
      { threadId: undefined },
    );
    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'queue_timeout' }),
    );
  });

  it('logs queue-full but does not send message when queue is full', async () => {
    const deps = createMockDeps();
    deps.requestQueue.enqueue.mockResolvedValue({ ok: false, reason: 'queue-full' });
    const event = makeSearchEvent();

    await handleSearch(deps, event);

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
    expect(deps.logger.logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'queue_full' }),
    );
  });

  it('preserves message_thread_id for topic groups', async () => {
    const deps = createMockDeps();
    const event = makeSearchEvent({ threadId: 42 });

    await handleSearch(deps, event);

    expect(deps.startTypingIndicator).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 42 }),
    );
    expect(deps.sendSafeMessage).toHaveBeenLastCalledWith(
      expect.anything(),
      -100123,
      expect.any(String),
      { threadId: 42 },
    );
  });

  it('does not log full user text in any bot event', async () => {
    const deps = createMockDeps();
    const event = makeSearchEvent({ args: 'secret search query', repliedText: 'secret reply' });

    await handleSearch(deps, event);

    for (const call of deps.logger.logBotEvent.mock.calls) {
      const event: BotEvent = call[0];
      const eventJson = JSON.stringify(event);
      expect(eventJson).not.toContain('secret search query');
      expect(eventJson).not.toContain('secret reply');
    }
  });
});
