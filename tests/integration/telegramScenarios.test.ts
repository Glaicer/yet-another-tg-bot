import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_USER_ID,
  ALLOWED_CHAT_ID,
  BOT_ID,
  BOT_USERNAME,
  REGULAR_USER_ID,
  makeGroupMessage,
  makePrivateMessage,
  setupApp,
} from '../helpers/integration.js';

describe('Telegram scenarios', () => {
  it('responds to mention in topic with message_thread_id preserved', async () => {
    const { app, captured, sendMessage } = await setupApp({
      callLlm: vi.fn().mockResolvedValue({ text: 'Hello from topic!' }),
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: `@${BOT_USERNAME} hello`,
        threadId: 42,
      }),
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const call = sendMessage.mock.calls[0][0];
    expect(call.chat_id).toBe(ALLOWED_CHAT_ID);
    expect(call.message_thread_id).toBe(42);

    await app.stop();
  });

  it('includes replied text when replying to another user while mentioning bot', async () => {
    const callLlm = vi.fn().mockResolvedValue({ text: 'Got it!' });
    const { app, captured, sendMessage } = await setupApp({
      callLlm,
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: `@${BOT_USERNAME} explain this`,
        replyToMessage: {
          message_id: 10,
          from: { id: 222, username: 'otheruser' },
          text: 'The sky is blue',
        },
      }),
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sentText = sendMessage.mock.calls[0][0].text;
    expect(sentText).toContain('Got it');

    // Verify the LLM was called with a request containing the replied text
    const llmCall = callLlm.mock.calls.find((call) => {
      const request = call[0] as { body?: { input?: unknown[] } };
      return Array.isArray(request.body?.input);
    })?.[0] as { body: { input?: unknown[]; messages?: unknown[] } };
    const messages = llmCall.body.input ?? llmCall.body.messages ?? [];
    const userMessage = messages.find((m: unknown) => (m as { role: string }).role === 'user') as
      | { content: string }
      | undefined;
    expect(userMessage?.content).toContain('The sky is blue');

    await app.stop();
  });

  it('responds when user replies to bot message without mention', async () => {
    const callLlm = vi.fn().mockResolvedValue({ text: 'Thanks for replying!' });
    const { app, captured, sendMessage } = await setupApp({
      callLlm,
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: 'Thanks!',
        replyToMessage: {
          message_id: 10,
          from: { id: BOT_ID, username: BOT_USERNAME },
          text: 'Previous bot message',
        },
      }),
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sentText = sendMessage.mock.calls[0][0].text;
    expect(sentText).toContain('Thanks for replying');

    const llmCall = callLlm.mock.calls.find((call) => {
      const request = call[0] as { body?: { input?: unknown[] } };
      return Array.isArray(request.body?.input);
    })?.[0] as { body: { input?: unknown[]; messages?: unknown[] } };
    const messages = llmCall.body.input ?? llmCall.body.messages ?? [];
    const userMessage = messages.find((m: unknown) => (m as { role: string }).role === 'user') as
      | { content: string }
      | undefined;
    expect(userMessage?.content).toContain('Replied message:\nPrevious bot message');

    await app.stop();
  });

  it('processes /search with replied message including context', async () => {
    const callLlm = vi.fn().mockResolvedValue({
      text: 'It is sunny.',
      sources: [{ title: 'Weather.com', url: 'https://weather.com' }],
    });
    const { app, captured, sendMessage } = await setupApp({
      callLlm,
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: '/search explain this',
        replyToMessage: {
          message_id: 10,
          from: { id: 222, username: 'otheruser' },
          text: 'The sky is blue today',
        },
      }),
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sentText = sendMessage.mock.calls[0][0].text;
    expect(sentText).toContain('It is sunny');
    expect(sentText).toContain('Sources:');
    expect(sentText).toMatch(/Weather\\\.com/);

    // Verify search prompt includes replied text
    const llmCall = callLlm.mock.calls.find((call) => {
      const request = call[0] as { body?: { tools?: unknown[] } };
      return Array.isArray(request.body?.tools);
    })?.[0] as { body: { input?: unknown[]; messages?: unknown[] } };
    const messages = llmCall.body.input ?? llmCall.body.messages ?? [];
    const userMessage = messages.find((m: unknown) => (m as { role: string }).role === 'user') as
      | { content: string }
      | undefined;
    expect(userMessage?.content).toContain('The sky is blue today');
    expect(userMessage?.content).toMatch(
      /^Context:\nReplied message:\nThe sky is blue today\n\nUse web search/u,
    );

    await app.stop();
  });

  it('sends unsupported reply text for media replies', async () => {
    const { app, captured, sendMessage, logBotEvent } = await setupApp();

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: `@${BOT_USERNAME} what about this?`,
        replyToMessage: {
          message_id: 10,
          from: { id: 222, username: 'otheruser' },
          photo: [{ file_id: 'photo1' }],
        },
      }),
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sentText = sendMessage.mock.calls[0][0].text;
    expect(sentText).toContain('only work with text messages');

    expect(logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'unsupported_reply',
        chatId: String(ALLOWED_CHAT_ID),
        userId: String(REGULAR_USER_ID),
      }),
    );

    await app.stop();
  });

  it('ignores messages from non-allowed chats', async () => {
    const { app, captured, sendMessage } = await setupApp({
      callLlm: vi.fn().mockResolvedValue({ text: 'Should not send' }),
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        chatId: -1009999999999,
        text: `@${BOT_USERNAME} hello`,
      }),
    );

    expect(sendMessage).not.toHaveBeenCalled();

    await app.stop();
  });

  it('persists admin persona selection in SQLite', async () => {
    const { app, mockDb, captured, sendMessage } = await setupApp({
      characterStoreOverrides: {
        listCharacters: ['default', 'sassy', 'formal'],
      },
    });

    // Select persona
    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makePrivateMessage({
        userId: ADMIN_USER_ID,
        text: '/persona sassy',
      }),
    );

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: ADMIN_USER_ID,
        text: 'Persona changed to: sassy',
      }),
    );

    // Verify SQLite persistence
    const row = mockDb
      .prepare('SELECT value FROM bot_settings WHERE key = ?')
      .get('selected_character') as { value: string } | undefined;
    expect(row?.value).toBe('sassy');

    await app.stop();
  });
});
