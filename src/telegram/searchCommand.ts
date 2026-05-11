import type { ResolvedConfig } from '../config/types.js';
import { hashString } from '../core/hash.js';
import type { RateLimiter } from '../core/rateLimiter.js';
import type { RequestQueue } from '../core/requestQueue.js';
import type { GuardrailsInput, GuardrailsResult } from '../guardrails/guardrailsService.js';
import type { LlmResponse, MapRequestOptions, MappedRequest } from '../llm/types.js';
import type { PromptInput, PromptMessage } from '../prompt/promptBuilder.js';
import type { BotEvent, ConsoleEvent, GuardrailEvent } from '../storage/logger.js';
import type { TelegramApi as SenderApi } from './sender.js';
import type { ParsedEvent } from './types.js';
import type { TelegramApi as TypingApi } from './typingIndicator.js';

type Api = SenderApi & TypingApi;

export type CharacterStoreLike = {
  getCurrentCharacter(): { name: string; content: string };
};

export type LoggerLike = {
  logBotEvent(event: BotEvent): void;
  logGuardrailEvent(event: GuardrailEvent): void;
  logConsoleEvent(event: ConsoleEvent): void;
};

export type GuardrailsLike = {
  check(input: GuardrailsInput): Promise<GuardrailsResult>;
};

export type SearchCommandDeps = {
  config: ResolvedConfig;
  characterStore: CharacterStoreLike;
  sendSafeMessage: (
    deps: { api: SenderApi; logger: LoggerLike },
    chatId: number,
    text: string,
    options?: { threadId?: number },
  ) => Promise<void>;
  api: Api;
  logger: LoggerLike;
  buildPrompt: (input: PromptInput) => PromptMessage[];
  mapLlmRequest: (config: ResolvedConfig, options: MapRequestOptions) => MappedRequest;
  callLlm: (request: MappedRequest, timeoutMs: number) => Promise<LlmResponse>;
  startTypingIndicator: (deps: {
    api: TypingApi;
    chatId: number;
    threadId?: number;
    logger?: LoggerLike;
  }) => {
    stop: () => void;
  };
  guardrails: GuardrailsLike;
  rateLimiter: RateLimiter;
  requestQueue: RequestQueue;
  systemPrompt: string;
};

export async function handleSearch(
  deps: SearchCommandDeps,
  event: Extract<ParsedEvent, { type: 'group_command' }>,
): Promise<void> {
  if (!deps.config.llm.supportsWebSearch) {
    return;
  }

  const { chatId, threadId, userId } = event;
  const text = event.args.trim();

  if (!text) {
    await deps.sendSafeMessage(
      { api: deps.api, logger: deps.logger },
      chatId,
      deps.config.messages.searchEmptyArgs,
      { threadId },
    );
    deps.logger.logBotEvent({
      type: 'command_search_empty',
      chatId: String(chatId),
      userId: String(userId),
    });
    return;
  }

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
        repliedText: event.repliedText,
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
        repliedText: event.repliedText,
        mode: 'search',
      });

      const request = deps.mapLlmRequest(deps.config, {
        messages,
        model: deps.config.llm.model,
        temperature: deps.config.llm.temperature,
        maxTokens: deps.config.llm.maxTokens,
        webSearch: true,
      });

      const response = await deps.callLlm(request, deps.config.timeouts.llmRequestMs);

      const formattedText = formatSearchResponse(response);

      await deps.sendSafeMessage({ api: deps.api, logger: deps.logger }, chatId, formattedText, {
        threadId,
      });

      deps.logger.logBotEvent({
        type: 'command_search',
        chatId: String(chatId),
        userId: String(userId),
        hash: hashString(text + (event.repliedText ?? '')),
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
          command: 'search',
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
        metadata: { chatId: String(chatId), userId: String(userId), command: 'search' },
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
        metadata: { chatId: String(chatId), userId: String(userId), command: 'search' },
      });
    }
  }
}

function formatSearchResponse(response: LlmResponse): string {
  let text = response.text;

  if (response.sources && response.sources.length > 0) {
    const sourceLines = response.sources.map(
      (source, index) => `${index + 1}. ${source.title} — ${source.url}`,
    );
    text += `\n\nSources:\n${sourceLines.join('\n')}`;
  }

  return text;
}
