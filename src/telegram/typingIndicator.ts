import type { ConsoleEvent } from '../storage/logger.js';

export type TelegramApi = {
  sendChatAction(params: {
    chat_id: number;
    action: string;
    message_thread_id?: number;
  }): Promise<unknown>;
};

export type TypingIndicatorDeps = {
  api: TelegramApi;
  chatId: number;
  threadId?: number;
  logger?: {
    logConsoleEvent(event: ConsoleEvent): void;
  };
};

const TYPING_INTERVAL_MS = 4000;

export function startTypingIndicator(deps: TypingIndicatorDeps): { stop: () => void } {
  const sendTyping = () => {
    deps.api
      .sendChatAction({
        chat_id: deps.chatId,
        action: 'typing',
        message_thread_id: deps.threadId,
      })
      .catch((error) => {
        deps.logger?.logConsoleEvent({
          level: 'warn',
          type: 'typing_indicator_error',
          message: error instanceof Error ? error.message : String(error),
          metadata: {
            chatId: String(deps.chatId),
            ...(deps.threadId !== undefined ? { threadId: String(deps.threadId) } : {}),
          },
        });
      });
  };

  sendTyping();
  const intervalId = setInterval(sendTyping, TYPING_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(intervalId);
    },
  };
}
