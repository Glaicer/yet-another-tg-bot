import type { ResolvedConfig } from '../config/types.js';
import { hashString } from '../core/hash.js';
import type { RateLimiter } from '../core/rateLimiter.js';
import type { RequestQueue } from '../core/requestQueue.js';
import type { GuardrailsInput, GuardrailsResult } from '../guardrails/guardrailsService.js';
import type { LlmResponse, MapRequestOptions, MappedRequest } from '../llm/types.js';
import type { PromptInput, PromptMessage } from '../prompt/promptBuilder.js';
import type { BotEvent, GuardrailEvent } from '../storage/logger.js';
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
  sendSafeMessage: (
    deps: { api: SenderApi; logger: LoggerLike },
    chatId: number,
    text: string,
    options?: { threadId?: number },
  ) => Promise<void>;
  startTypingIndicator: (deps: { api: TypingApi; chatId: number; threadId?: number }) => {
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
      case 'group_request': {
        await handleGroupRequest(deps, event);
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

async function handleGroupRequest(
  deps: MessageHandlerDeps,
  event: Extract<ParsedEvent, { type: 'group_request' }>,
): Promise<void> {
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
    const typing = deps.startTypingIndicator({ api: deps.api, chatId, threadId });
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
      const messages = deps.buildPrompt({
        systemPrompt: deps.systemPrompt,
        character: character.content,
        userText: text,
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
    } else if (queueResult.reason === 'queue-full') {
      deps.logger.logBotEvent({
        type: 'queue_full',
        chatId: String(chatId),
        userId: String(userId),
      });
    }
  }
}
