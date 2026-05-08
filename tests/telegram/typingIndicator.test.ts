import { describe, expect, it, vi } from 'vitest';
import { startTypingIndicator } from '../../src/telegram/typingIndicator.js';

function createMockApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendChatAction: vi.fn().mockResolvedValue(true),
  };
}

describe('startTypingIndicator', () => {
  it('calls sendChatAction immediately with typing action', () => {
    const api = createMockApi();

    startTypingIndicator({ api, chatId: 123 });

    expect(api.sendChatAction).toHaveBeenCalledTimes(1);
    expect(api.sendChatAction).toHaveBeenCalledWith({
      chat_id: 123,
      action: 'typing',
    });
  });

  it('includes message_thread_id when threadId is provided', () => {
    const api = createMockApi();

    startTypingIndicator({ api, chatId: 123, threadId: 42 });

    expect(api.sendChatAction).toHaveBeenCalledTimes(1);
    expect(api.sendChatAction).toHaveBeenCalledWith({
      chat_id: 123,
      action: 'typing',
      message_thread_id: 42,
    });
  });

  it('repeats sendChatAction at interval', () => {
    vi.useFakeTimers();
    const api = createMockApi();

    startTypingIndicator({ api, chatId: 123 });
    expect(api.sendChatAction).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000);
    expect(api.sendChatAction).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(4000);
    expect(api.sendChatAction).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('stops sending after stop() is called', () => {
    vi.useFakeTimers();
    const api = createMockApi();

    const indicator = startTypingIndicator({ api, chatId: 123 });
    expect(api.sendChatAction).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000);
    expect(api.sendChatAction).toHaveBeenCalledTimes(2);

    indicator.stop();

    vi.advanceTimersByTime(4000);
    expect(api.sendChatAction).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('does not throw if sendChatAction rejects', () => {
    const api = createMockApi();
    api.sendChatAction.mockRejectedValue(new Error('Telegram error'));

    expect(() => {
      startTypingIndicator({ api, chatId: 123 });
    }).not.toThrow();
  });

  it('continues interval even if a single sendChatAction fails', () => {
    vi.useFakeTimers();
    const api = createMockApi();
    api.sendChatAction
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Telegram error'))
      .mockResolvedValue(true);

    startTypingIndicator({ api, chatId: 123 });
    expect(api.sendChatAction).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000);
    expect(api.sendChatAction).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(4000);
    expect(api.sendChatAction).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});
