import type { ResolvedConfig } from '../config/types.js';
import { hashString } from '../core/hash.js';
import type { RateLimiter } from '../core/rateLimiter.js';
import type { RequestQueue } from '../core/requestQueue.js';
import type { GuardrailsInput, GuardrailsResult } from '../guardrails/guardrailsService.js';
import type { LlmResponse, MapRequestOptions, MappedRequest } from '../llm/types.js';
import type { PromptInput, PromptMessage } from '../prompt/promptBuilder.js';
import type { BotEvent, ConsoleEvent, GuardrailEvent } from '../storage/logger.js';
import type { FirecrawlPage } from '../web/firecrawlClient.js';
import { extractUrls } from '../web/urlExtractor.js';
import { handleAdminCommand, handleGroupCommand } from './commands.js';
import type { TelegramApi as SenderApi } from './sender.js';
import type { ParsedEvent } from './types.js';
import type { TelegramApi as TypingApi } from './typingIndicator.js';

type Api = SenderApi & TypingApi;

export type CharacterStoreLike = {
  getCurrentCharacter(): { name: string; content: string };
  listCharacters(): string[];
  selectCharacter(name: string): boolean;
};

export type LoggerLike = {
  logBotEvent(event: BotEvent): void;
  logGuardrailEvent(event: GuardrailEvent): void;
  logConsoleEvent(event: ConsoleEvent): void;
};

export type GuardrailsLike = {
  check(input: GuardrailsInput): Promise<GuardrailsResult>;
};

export type MessageHandlerDeps = {
  config: ResolvedConfig;
  rateLimiter: RateLimiter;
  requestQueue: RequestQueue;
  guardrails: GuardrailsLike;
  characterStore: CharacterStoreLike;
  buildPrompt: (input: PromptInput) => PromptMessage[];
  mapLlmRequest: (config: ResolvedConfig, options: MapRequestOptions) => MappedRequest;
  callLlm: (request: MappedRequest, timeoutMs: number) => Promise<LlmResponse>;
  scrapeUrl?: (url: string) => Promise<FirecrawlPage>;
  sendSafeMessage: (
    deps: { api: SenderApi; logger: LoggerLike },
    chatId: number,
    text: string,
    options?: { threadId?: number },
  ) => Promise<void>;
  startTypingIndicator: (deps: {
    api: TypingApi;
    chatId: number;
    threadId?: number;
    logger?: LoggerLike;
  }) => {
    stop: () => void;
  };
  api: Api;
  logger: LoggerLike;
  systemPrompt: string;
  getUptimeSeconds: () => number;
};

export type MessageHandler = (event: ParsedEvent) => Promise<void>;

export function createMessageHandler(deps: MessageHandlerDeps): MessageHandler {
  return async (event: ParsedEvent) => {
    switch (event.type) {
      case 'ignored':
      case 'no-op': {
        return;
      }
      case 'unsupported_reply': {
        await handleUnsupportedReply(deps, event);
        return;
      }
      case 'new_chat_member': {
        await handleNewChatMember(deps, event);
        return;
      }
      case 'group_request': {
        await handleGroupRequest(deps, event);
        return;
      }
      case 'admin_request': {
        await handleAdminRequest(deps, event);
        return;
      }
      case 'group_command': {
        await handleGroupCommand(deps, event);
        return;
      }
      case 'admin_command': {
        await handleAdminCommand(deps, event);
        return;
      }
      default: {
        return;
      }
    }
  };
}

async function handleUnsupportedReply(
  deps: MessageHandlerDeps,
  event: Extract<ParsedEvent, { type: 'unsupported_reply' }>,
): Promise<void> {
  await deps.sendSafeMessage(
    { api: deps.api, logger: deps.logger },
    event.chatId,
    deps.config.messages.unsupportedReply,
    { threadId: event.threadId },
  );
  deps.logger.logBotEvent({
    type: 'unsupported_reply',
    chatId: String(event.chatId),
    userId: String(event.userId),
  });
}

async function handleNewChatMember(
  deps: MessageHandlerDeps,
  event: Extract<ParsedEvent, { type: 'new_chat_member' }>,
): Promise<void> {
  await deps.sendSafeMessage(
    { api: deps.api, logger: deps.logger },
    event.chatId,
    deps.config.messages.greetUser,
    { threadId: event.threadId },
  );
  deps.logger.logBotEvent({
    type: 'greet_user',
    chatId: String(event.chatId),
    userId: String(event.userId),
  });
}

type LlmRequestEvent = {
  chatId: number;
  threadId?: number;
  userId: number;
  text: string;
  repliedText?: string;
};

async function handleGroupRequest(
  deps: MessageHandlerDeps,
  event: Extract<ParsedEvent, { type: 'group_request' }>,
): Promise<void> {
  await handleLlmRequest(deps, event);
}

async function handleAdminRequest(
  deps: MessageHandlerDeps,
  event: Extract<ParsedEvent, { type: 'admin_request' }>,
): Promise<void> {
  await handleLlmRequest(deps, event);
}

async function handleLlmRequest(deps: MessageHandlerDeps, event: LlmRequestEvent): Promise<void> {
  const { chatId, threadId, userId, text, repliedText } = event;

  const rateResult = deps.rateLimiter.check(String(userId), String(chatId));
  if (!rateResult.allowed) {
    await deps.sendSafeMessage(
      { api: deps.api, logger: deps.logger },
      chatId,
      deps.config.messages.rateLimitExceeded,
      { threadId },
    );
    deps.logger.logBotEvent({
      type: 'rate_limit',
      chatId: String(chatId),
      userId: String(userId),
      metadata: { retryAfterMs: rateResult.retryAfterMs },
    });
    return;
  }

  const queueResult = await deps.requestQueue.enqueue(async () => {
    const typing = deps.startTypingIndicator({
      api: deps.api,
      chatId,
      threadId,
      logger: deps.logger,
    });
    try {
      const guardrailsResult = await deps.guardrails.check({
        userText: text,
        repliedText,
        chatId: String(chatId),
        userId: String(userId),
      });

      if (!guardrailsResult.allowed) {
        await deps.sendSafeMessage(
          { api: deps.api, logger: deps.logger },
          chatId,
          guardrailsResult.reason || deps.config.messages.llmError,
          { threadId },
        );
        return;
      }

      const character = deps.characterStore.getCurrentCharacter();
      const promptUserText = await buildUserTextWithUrlContext(deps, text);
      const messages = deps.buildPrompt({
        systemPrompt: deps.systemPrompt,
        character: character.content,
        userText: promptUserText,
        repliedText,
      });

      const request = deps.mapLlmRequest(deps.config, {
        messages,
        model: deps.config.llm.model,
        temperature: deps.config.llm.temperature,
        maxTokens: deps.config.llm.maxTokens,
      });

      const response = await deps.callLlm(request, deps.config.timeouts.llmRequestMs);

      await deps.sendSafeMessage({ api: deps.api, logger: deps.logger }, chatId, response.text, {
        threadId,
      });

      deps.logger.logBotEvent({
        type: 'group_response',
        chatId: String(chatId),
        userId: String(userId),
        hash: hashString(text + (repliedText ?? '')),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await deps.sendSafeMessage(
        { api: deps.api, logger: deps.logger },
        chatId,
        deps.config.messages.llmError,
        { threadId },
      );
      deps.logger.logBotEvent({
        type: 'llm_error',
        chatId: String(chatId),
        userId: String(userId),
        metadata: { error: errorMessage },
      });
      deps.logger.logConsoleEvent({
        level: 'error',
        type: 'llm_error',
        message: errorMessage,
        metadata: {
          chatId: String(chatId),
          userId: String(userId),
        },
      });
    } finally {
      typing.stop();
    }
  });

  if (!queueResult.ok) {
    if (queueResult.reason === 'timeout') {
      await deps.sendSafeMessage(
        { api: deps.api, logger: deps.logger },
        chatId,
        deps.config.messages.queueTimeout,
        { threadId },
      );
      deps.logger.logBotEvent({
        type: 'queue_timeout',
        chatId: String(chatId),
        userId: String(userId),
      });
      deps.logger.logConsoleEvent({
        level: 'warn',
        type: 'queue_timeout',
        message: 'Request queue timed out',
        metadata: { chatId: String(chatId), userId: String(userId) },
      });
    } else if (queueResult.reason === 'queue-full') {
      deps.logger.logBotEvent({
        type: 'queue_full',
        chatId: String(chatId),
        userId: String(userId),
      });
      deps.logger.logConsoleEvent({
        level: 'warn',
        type: 'queue_full',
        message: 'Request queue is full',
        metadata: { chatId: String(chatId), userId: String(userId) },
      });
    }
  }
}

async function buildUserTextWithUrlContext(
  deps: MessageHandlerDeps,
  text: string,
): Promise<string> {
  const urls = extractUrls(text);
  if (urls.size === 0) {
    return text;
  }

  if (!deps.config.firecrawl?.apiKey || !deps.scrapeUrl) {
    return `${text}\n\n<IMPORTANT> Mention to the user that URL handling is switched off now.`;
  }

  const pages = await Promise.all(
    [...urls].map(async (url) => {
      try {
        return await deps.scrapeUrl?.(url);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        deps.logger.logBotEvent({
          type: 'firecrawl_error',
          metadata: { url, error: errorMessage },
        });
        deps.logger.logConsoleEvent({
          level: 'warn',
          type: 'firecrawl_error',
          message: errorMessage,
          metadata: { url },
        });
        return {
          url,
          markdown: `Firecrawl could not retrieve this page: ${errorMessage}`,
        };
      }
    }),
  );

  const pageContext = pages
    .filter((page): page is FirecrawlPage => page !== undefined)
    .map((page, index) => {
      const title = page.title ? ` (${page.title})` : '';
      return `## Page ${index + 1}: ${page.url}${title}\n\n${page.markdown}`;
    })
    .join('\n\n');

  return [
    text,
    'User supplied web pages as additional context. Use the extracted markdown below as supporting material, but prefer the user request when there is any conflict.',
    pageContext,
  ].join('\n\n');
}
