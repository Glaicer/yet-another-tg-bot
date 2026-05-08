import { describe, expect, it, vi } from 'vitest';
import type { BotEvent } from '../../src/storage/logger.js';
import { sendSafeMessage } from '../../src/telegram/sender.js';

function createMockApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendChatAction: vi.fn().mockResolvedValue(true),
  };
}

function createMockLogger() {
  return {
    logBotEvent: vi.fn(),
    logGuardrailEvent: vi.fn(),
  };
}

describe('sendSafeMessage', () => {
  it('sends text with MarkdownV2 parse mode', async () => {
    const api = createMockApi();
    const logger = createMockLogger();

    await sendSafeMessage({ api, logger }, 123, 'Hello world');

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith({
      chat_id: 123,
      text: 'Hello world',
      parse_mode: 'MarkdownV2',
    });
  });

  it('escapes MarkdownV2 special characters', async () => {
    const api = createMockApi();
    const logger = createMockLogger();

    await sendSafeMessage({ api, logger }, 123, 'Use _underscore_ and *star*');

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith({
      chat_id: 123,
      text: 'Use \\_underscore\\_ and \\*star\\*',
      parse_mode: 'MarkdownV2',
    });
  });

  it('preserves message_thread_id when provided', async () => {
    const api = createMockApi();
    const logger = createMockLogger();

    await sendSafeMessage({ api, logger }, 123, 'Topic message', { threadId: 42 });

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith({
      chat_id: 123,
      text: 'Topic message',
      parse_mode: 'MarkdownV2',
      message_thread_id: 42,
    });
  });

  it('retries once without parse mode on MarkdownV2 parse failure', async () => {
    const api = createMockApi();
    api.sendMessage
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Unexpected character '>'"),
      )
      .mockResolvedValueOnce({ message_id: 2 });

    const logger = createMockLogger();

    await sendSafeMessage({ api, logger }, 123, 'Some > text');

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenNthCalledWith(1, {
      chat_id: 123,
      text: 'Some \\> text',
      parse_mode: 'MarkdownV2',
    });
    expect(api.sendMessage).toHaveBeenNthCalledWith(2, {
      chat_id: 123,
      text: 'Some > text',
      message_thread_id: undefined,
    });
  });

  it('logs fallback send when MarkdownV2 fails', async () => {
    const api = createMockApi();
    api.sendMessage
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities"))
      .mockResolvedValueOnce({ message_id: 2 });

    const logger = createMockLogger();

    await sendSafeMessage({ api, logger }, 123, 'text');

    expect(logger.logBotEvent).toHaveBeenCalledTimes(1);
    const event: BotEvent = logger.logBotEvent.mock.calls[0][0];
    expect(event.type).toBe('markdown_fallback');
    expect(event.chatId).toBe('123');
    expect(event.details).toContain('MarkdownV2');
  });

  it('retries without parse mode and preserves threadId', async () => {
    const api = createMockApi();
    api.sendMessage
      .mockRejectedValueOnce(new Error("can't parse entities"))
      .mockResolvedValueOnce({ message_id: 2 });

    const logger = createMockLogger();

    await sendSafeMessage({ api, logger }, 123, 'text', { threadId: 7 });

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenNthCalledWith(2, {
      chat_id: 123,
      text: 'text',
      message_thread_id: 7,
    });
  });

  it('re-throws non-formatting errors without retry', async () => {
    const api = createMockApi();
    api.sendMessage.mockRejectedValueOnce(new Error('Network error'));

    const logger = createMockLogger();

    await expect(sendSafeMessage({ api, logger }, 123, 'text')).rejects.toThrow('Network error');

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(logger.logBotEvent).not.toHaveBeenCalled();
  });

  it('does not retry if fallback also fails', async () => {
    const api = createMockApi();
    api.sendMessage
      .mockRejectedValueOnce(new Error("can't parse entities"))
      .mockRejectedValueOnce(new Error('Second failure'));

    const logger = createMockLogger();

    await expect(sendSafeMessage({ api, logger }, 123, 'text')).rejects.toThrow('Second failure');

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(logger.logBotEvent).toHaveBeenCalledTimes(1);
  });

  it('matches case-insensitive parse entity errors', async () => {
    const api = createMockApi();
    api.sendMessage
      .mockRejectedValueOnce(new Error("Can't parse entities"))
      .mockResolvedValueOnce({ message_id: 2 });

    const logger = createMockLogger();

    await sendSafeMessage({ api, logger }, 123, 'text');

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });
});
