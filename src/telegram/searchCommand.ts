import type { ResolvedConfig } from '../config/types.js';
import { hashString } from '../core/hash.js';
import type { RateLimiter } from '../core/rateLimiter.js';
import type { RequestQueue } from '../core/requestQueue.js';
import type { GuardrailsInput, GuardrailsResult } from '../guardrails/guardrailsService.js';
import type { LlmResponse, MapRequestOptions, MappedRequest } from '../llm/types.js';
import type { PromptInput, PromptMessage } from '../prompt/promptBuilder.js';
import type { BotEvent, GuardrailEvent } from '../storage/logger.js';
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
  startTypingIndicator: (deps: { api: TypingApi; chatId: number; threadId?: number }) => {
    stop: () => void;
  };
  guardrails: GuardrailsLike;
  rateLimiter: RateLimiter;
  requestQueue: RequestQueue;
  systemPrompt: string;
  unsupportedReplyText: string;
  rateLimitMessage: string;
  queueTimeoutMessage: string;
  queueFullMessage: string;
  llmErrorMessage: string;
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
      'Please provide a search instruction: /search <instruction>',
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
      deps.rateLimitMessage,
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
        repliedText: event.repliedText,
        chatId: String(chatId),
        userId: String(userId),
      });

      if (!guardrailsResult.allowed) {
        await deps.sendSafeMessage(
          { api: deps.api, logger: deps.logger },
          chatId,
          guardrailsResult.reason || deps.llmErrorMessage,
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
        deps.llmErrorMessage,
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
        deps.queueTimeoutMessage,
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

function formatSearchResponse(response: LlmResponse): string {
  let text = response.text;

  if (response.sources && response.sources.length > 0) {
    const sourceLines = response.sources.map(
      (source, index) => `${index + 1}. ${source.title} — ${source.url}`,
    );
    text += `\n\nSources:\n${sourceLines.join('\n')}`;
  } else {
    text += '\n\nI could not confirm this claim with sources.';
  }

  return text;
}
