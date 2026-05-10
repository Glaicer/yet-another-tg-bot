import { formatTelegramMarkdownV2 } from '../prompt/markdown.js';
import type { BotEvent, ConsoleEvent } from '../storage/logger.js';

export type TelegramApi = {
  sendMessage(params: {
    chat_id: number;
    text: string;
    parse_mode?: string;
    message_thread_id?: number;
  }): Promise<unknown>;
};

export type SenderLogger = {
  logBotEvent(event: BotEvent): void;
  logConsoleEvent(event: ConsoleEvent): void;
};

export type SenderDeps = {
  api: TelegramApi;
  logger: SenderLogger;
};

function isParseModeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const description =
    error instanceof Error && 'description' in error
      ? String((error as Record<string, unknown>).description)
      : '';
  const pattern = /can't parse entities/i;
  return pattern.test(message) || pattern.test(description);
}

export async function sendSafeMessage(
  deps: SenderDeps,
  chatId: number,
  text: string,
  options?: { threadId?: number },
): Promise<void> {
  const escaped = formatTelegramMarkdownV2(text);
  const payload: Parameters<TelegramApi['sendMessage']>[0] = {
    chat_id: chatId,
    text: escaped,
    parse_mode: 'MarkdownV2',
  };
  if (options?.threadId !== undefined) {
    payload.message_thread_id = options.threadId;
  }

  try {
    await deps.api.sendMessage(payload);
  } catch (err) {
    if (isParseModeError(err)) {
      deps.logger.logBotEvent({
        type: 'markdown_fallback',
        chatId: String(chatId),
        details: 'MarkdownV2 parse failed, retrying without parse_mode',
      });
      const fallbackPayload: Parameters<TelegramApi['sendMessage']>[0] = {
        chat_id: chatId,
        text,
      };
      if (options?.threadId !== undefined) {
        fallbackPayload.message_thread_id = options.threadId;
      }
      try {
        await deps.api.sendMessage(fallbackPayload);
      } catch (fallbackError) {
        deps.logger.logConsoleEvent({
          level: 'error',
          type: 'telegram_send_error',
          message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          metadata: { chatId: String(chatId), phase: 'plain_text' },
        });
        throw fallbackError;
      }
    } else {
      deps.logger.logConsoleEvent({
        level: 'error',
        type: 'telegram_send_error',
        message: err instanceof Error ? err.message : String(err),
        metadata: { chatId: String(chatId), phase: 'markdown' },
      });
      throw err;
    }
  }
}
