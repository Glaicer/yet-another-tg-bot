import { describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../../src/config/types.js';
import { hashString } from '../../src/core/hash.js';
import type { BotEvent } from '../../src/storage/logger.js';
import {
  type MessageHandlerDeps,
  createMessageHandler,
} from '../../src/telegram/messageHandler.js';
import type { ParsedEvent } from '../../src/telegram/types.js';

function createMockDeps(): MessageHandlerDeps {
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
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 800,
        supportsWebSearch: true,
      },
      timeouts: {
        llmRequestMs: 5000,
      },
      messages,
    } as ResolvedConfig,
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
    guardrails: {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    },
    characterStore: {
      getCurrentCharacter: vi.fn().mockReturnValue({ name: 'default', content: 'Friendly bot' }),
      listCharacters: vi.fn().mockReturnValue(['default']),
      selectCharacter: vi.fn().mockReturnValue(true),
    },
    buildPrompt: vi.fn().mockReturnValue([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User request' },
    ]),
    mapLlmRequest: vi.fn().mockReturnValue({
      url: 'https://api.test.com/v1/chat/completions',
      headers: { Authorization: 'Bearer test' },
      body: { model: 'gpt-4', messages: [] },
    }),
    callLlm: vi.fn().mockResolvedValue({ text: 'LLM response' }),
    sendSafeMessage: vi.fn().mockResolvedValue(undefined),
    startTypingIndicator: vi.fn().mockReturnValue({ stop: vi.fn() }),
    api: {
      sendMessage: vi.fn().mockResolvedValue({}),
      sendChatAction: vi.fn().mockResolvedValue({}),
    },
    logger: {
      logBotEvent: vi.fn(),
      logGuardrailEvent: vi.fn(),
    },
    systemPrompt: 'You are a helpful assistant.',
    getUptimeSeconds: vi.fn().mockReturnValue(42),
  } as unknown as MessageHandlerDeps;
}

function makeGroupRequest(
  overrides: Partial<Extract<ParsedEvent, { type: 'group_request' }>> = {},
): ParsedEvent {
  return {
    type: 'group_request',
    chatId: -1001234567890,
    threadId: undefined,
    userId: 111,
    text: 'Hello bot',
    ...overrides,
  } as ParsedEvent;
}

describe('createMessageHandler', () => {
  it('does nothing for ignored events', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);

    await handler({ type: 'ignored' });

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
    expect(deps.logger.logBotEvent).not.toHaveBeenCalled();
  });

  it('does nothing for no-op events', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);

    await handler({ type: 'no-op' });

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
    expect(deps.logger.logBotEvent).not.toHaveBeenCalled();
  });

  it('does nothing for unknown group_command', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);

    await handler({
      type: 'group_command',
      chatId: -1001234567890,
      userId: 111,
      command: 'unknown',
      args: '',
    });

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
  });

  it('does nothing for unknown admin_command', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);

    await handler({
      type: 'admin_command',
      userId: 12345,
      command: 'unknown',
      args: '',
    });

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
  });

  it('sends unsupported reply text for unsupported_reply events', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);

    await handler({
      type: 'unsupported_reply',
      chatId: -1001234567890,
      threadId: 7,
      userId: 111,
    });

    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -1001234567890,
      deps.config.messages.unsupportedReply,
      { threadId: 7 },
    );

    expect(deps.logger.logBotEvent).toHaveBeenCalledTimes(1);
    const event: BotEvent = deps.logger.logBotEvent.mock.calls[0][0];
    expect(event.type).toBe('unsupported_reply');
    expect(event.chatId).toBe(String(-1001234567890));
    expect(event.userId).toBe('111');
  });

  it('processes normal mention flow through the full pipeline', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest({ text: 'What is the weather?' });

    await handler(event);

    expect(deps.rateLimiter.check).toHaveBeenCalledWith('111', String(-1001234567890));
    expect(deps.requestQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.startTypingIndicator).toHaveBeenCalledWith({
      api: deps.api,
      chatId: -1001234567890,
      threadId: undefined,
    });
    expect(deps.guardrails.check).toHaveBeenCalledWith({
      userText: 'What is the weather?',
      repliedText: undefined,
      chatId: String(-1001234567890),
      userId: '111',
    });
    expect(deps.buildPrompt).toHaveBeenCalledWith({
      systemPrompt: deps.systemPrompt,
      character: 'Friendly bot',
      userText: 'What is the weather?',
      repliedText: undefined,
    });
    expect(deps.mapLlmRequest).toHaveBeenCalledWith(deps.config, {
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User request' },
      ],
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 800,
    });
    expect(deps.callLlm).toHaveBeenCalledWith(
      {
        url: 'https://api.test.com/v1/chat/completions',
        headers: { Authorization: 'Bearer test' },
        body: { model: 'gpt-4', messages: [] },
      },
      5000,
    );
    expect(deps.sendSafeMessage).toHaveBeenLastCalledWith(
      { api: deps.api, logger: deps.logger },
      -1001234567890,
      'LLM response',
      { threadId: undefined },
    );

    expect(deps.logger.logBotEvent).toHaveBeenCalledTimes(1);
    const eventLog: BotEvent = deps.logger.logBotEvent.mock.calls[0][0];
    expect(eventLog.type).toBe('group_response');
    expect(eventLog.chatId).toBe(String(-1001234567890));
    expect(eventLog.userId).toBe('111');
    expect(eventLog.hash).toBe(hashString('What is the weather?'));
  });

  it('includes replied text for reply-to-other flow', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest({
      text: 'Can you explain this?',
      repliedText: 'The sky is blue',
    });

    await handler(event);

    expect(deps.guardrails.check).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: 'Can you explain this?',
        repliedText: 'The sky is blue',
      }),
    );
    expect(deps.buildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: 'Can you explain this?',
        repliedText: 'The sky is blue',
      }),
    );
    expect(deps.logger.logBotEvent).toHaveBeenCalledTimes(1);
    const eventLog: BotEvent = deps.logger.logBotEvent.mock.calls[0][0];
    expect(eventLog.hash).toBe(hashString('Can you explain this?The sky is blue'));
  });

  it('works for reply-to-bot flow (no repliedText)', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest({ text: 'Thanks for the info' });

    await handler(event);

    expect(deps.guardrails.check).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: 'Thanks for the info',
        repliedText: undefined,
      }),
    );
    expect(deps.buildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: 'Thanks for the info',
        repliedText: undefined,
      }),
    );
    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
  });

  it('preserves message_thread_id for topic groups', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest({ threadId: 42 });

    await handler(event);

    expect(deps.startTypingIndicator).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 42 }),
    );
    expect(deps.sendSafeMessage).toHaveBeenLastCalledWith(
      expect.anything(),
      -1001234567890,
      'LLM response',
      { threadId: 42 },
    );
  });

  it('sends rate-limit message and logs when rate limit exceeded', async () => {
    const deps = createMockDeps();
    deps.rateLimiter.check.mockReturnValue({ allowed: false, retryAfterMs: 30000 });
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest();

    await handler(event);

    expect(deps.requestQueue.enqueue).not.toHaveBeenCalled();
    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -1001234567890,
      deps.config.messages.rateLimitExceeded,
      { threadId: undefined },
    );

    expect(deps.logger.logBotEvent).toHaveBeenCalledTimes(1);
    const eventLog: BotEvent = deps.logger.logBotEvent.mock.calls[0][0];
    expect(eventLog.type).toBe('rate_limit');
    expect(eventLog.metadata).toEqual({ retryAfterMs: 30000 });
  });

  it('blocks before LLM when guardrails disallows', async () => {
    const deps = createMockDeps();
    deps.guardrails.check.mockResolvedValue({ allowed: false, reason: 'Blocked by guardrails' });
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest();

    await handler(event);

    expect(deps.buildPrompt).not.toHaveBeenCalled();
    expect(deps.mapLlmRequest).not.toHaveBeenCalled();
    expect(deps.callLlm).not.toHaveBeenCalled();
    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -1001234567890,
      'Blocked by guardrails',
      { threadId: undefined },
    );
  });

  it('proceeds to LLM when guardrails allows (covers fail-open)', async () => {
    const deps = createMockDeps();
    deps.guardrails.check.mockResolvedValue({ allowed: true });
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest();

    await handler(event);

    expect(deps.callLlm).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
  });

  it('sends error message and logs on LLM error', async () => {
    const deps = createMockDeps();
    deps.callLlm.mockRejectedValue(new Error('LLM request failed: 500'));
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest();

    await handler(event);

    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -1001234567890,
      deps.config.messages.llmError,
      { threadId: undefined },
    );

    expect(deps.logger.logBotEvent).toHaveBeenCalledTimes(1);
    const eventLog: BotEvent = deps.logger.logBotEvent.mock.calls[0][0];
    expect(eventLog.type).toBe('llm_error');
    expect(eventLog.metadata).toEqual({ error: 'LLM request failed: 500' });
  });

  it('sends error message and logs on LLM timeout', async () => {
    const deps = createMockDeps();
    deps.callLlm.mockRejectedValue(new Error('LLM request timed out after 5000ms'));
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest();

    await handler(event);

    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -1001234567890,
      deps.config.messages.llmError,
      { threadId: undefined },
    );

    const eventLog: BotEvent = deps.logger.logBotEvent.mock.calls[0][0];
    expect(eventLog.type).toBe('llm_error');
    expect(eventLog.metadata).toEqual({ error: 'LLM request timed out after 5000ms' });
  });

  it('sends queue timeout message and logs when queue times out', async () => {
    const deps = createMockDeps();
    deps.requestQueue.enqueue.mockResolvedValue({ ok: false, reason: 'timeout' });
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest();

    await handler(event);

    // typing indicator is started inside the queue task, but the task never completes
    // in this mock. In real queue timeout-while-waiting, the task never runs.
    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      { api: deps.api, logger: deps.logger },
      -1001234567890,
      deps.config.messages.queueTimeout,
      { threadId: undefined },
    );

    expect(deps.logger.logBotEvent).toHaveBeenCalledTimes(1);
    const eventLog: BotEvent = deps.logger.logBotEvent.mock.calls[0][0];
    expect(eventLog.type).toBe('queue_timeout');
  });

  it('logs queue-full but does not send a message to user', async () => {
    const deps = createMockDeps();
    deps.requestQueue.enqueue.mockResolvedValue({ ok: false, reason: 'queue-full' });
    const handler = createMessageHandler(deps);
    const event = makeGroupRequest();

    await handler(event);

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
    expect(deps.logger.logBotEvent).toHaveBeenCalledTimes(1);
    const eventLog: BotEvent = deps.logger.logBotEvent.mock.calls[0][0];
    expect(eventLog.type).toBe('queue_full');
  });

  it('stops typing indicator after successful response', async () => {
    const deps = createMockDeps();
    const stopTyping = vi.fn();
    deps.startTypingIndicator.mockReturnValue({ stop: stopTyping });
    const handler = createMessageHandler(deps);

    await handler(makeGroupRequest());

    expect(stopTyping).toHaveBeenCalledTimes(1);
  });

  it('stops typing indicator after LLM error', async () => {
    const deps = createMockDeps();
    const stopTyping = vi.fn();
    deps.startTypingIndicator.mockReturnValue({ stop: stopTyping });
    deps.callLlm.mockRejectedValue(new Error('fail'));
    const handler = createMessageHandler(deps);

    await handler(makeGroupRequest());

    expect(stopTyping).toHaveBeenCalledTimes(1);
  });

  it('stops typing indicator after guardrail block', async () => {
    const deps = createMockDeps();
    const stopTyping = vi.fn();
    deps.startTypingIndicator.mockReturnValue({ stop: stopTyping });
    deps.guardrails.check.mockResolvedValue({ allowed: false, reason: 'Unsafe' });
    const handler = createMessageHandler(deps);

    await handler(makeGroupRequest());

    expect(stopTyping).toHaveBeenCalledTimes(1);
  });

  it('does not send placeholder messages during normal flow', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);

    await handler(makeGroupRequest());

    // Only the final LLM response should be sent
    expect(deps.sendSafeMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      'LLM response',
      expect.anything(),
    );
  });

  it('dispatches /search command through the full pipeline', async () => {
    const deps = createMockDeps();
    deps.callLlm.mockResolvedValue({
      text: 'Search result with sources.',
      sources: [{ title: 'Example', url: 'https://example.com' }],
    });
    const handler = createMessageHandler(deps);

    await handler({
      type: 'group_command',
      chatId: -1001234567890,
      threadId: 7,
      userId: 111,
      command: 'search',
      args: 'what is the weather',
    } as ParsedEvent);

    expect(deps.startTypingIndicator).toHaveBeenCalledTimes(1);
    expect(deps.callLlm).toHaveBeenCalledTimes(1);
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      expect.anything(),
      -1001234567890,
      expect.stringContaining('Search result with sources.'),
      { threadId: 7 },
    );
    expect(deps.sendSafeMessage).toHaveBeenCalledWith(
      expect.anything(),
      -1001234567890,
      expect.stringContaining('Example'),
      { threadId: 7 },
    );
  });

  it('does nothing for /search when web search is unsupported', async () => {
    const deps = createMockDeps();
    (deps.config.llm as Record<string, unknown>).supportsWebSearch = false;
    const handler = createMessageHandler(deps);

    await handler({
      type: 'group_command',
      chatId: -1001234567890,
      threadId: undefined,
      userId: 111,
      command: 'search',
      args: 'what is the weather',
    } as ParsedEvent);

    expect(deps.sendSafeMessage).not.toHaveBeenCalled();
    expect(deps.logger.logBotEvent).not.toHaveBeenCalled();
  });

  it('does not log full user text in any bot event', async () => {
    const deps = createMockDeps();
    const handler = createMessageHandler(deps);
    const userText = 'secret message content here';

    await handler(makeGroupRequest({ text: userText, repliedText: 'replied content' }));

    for (const call of deps.logger.logBotEvent.mock.calls) {
      const event: BotEvent = call[0];
      const eventJson = JSON.stringify(event);
      expect(eventJson).not.toContain(userText);
      expect(eventJson).not.toContain('replied content');
    }
  });
});
