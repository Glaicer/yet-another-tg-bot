import fs from 'node:fs';
import type Database from 'better-sqlite3';
import type { Update } from 'grammy/types';
import { CharacterStore } from './characters/characterStore.js';
import { type LoadConfigOptions, loadConfig } from './config/loadConfig.js';
import type { ResolvedConfig } from './config/types.js';
import { createRateLimiter } from './core/rateLimiter.js';
import { createRequestQueue } from './core/requestQueue.js';
import { createGuardrailsService } from './guardrails/guardrailsService.js';
import { type HealthServer, createHealthServer } from './http/health.js';
import { callLlm } from './llm/client.js';
import type { callLlm as CallLlmType } from './llm/client.js';
import { mapRequest } from './llm/requestMapper.js';
import { buildPrompt } from './prompt/promptBuilder.js';
import { createDatabase } from './storage/database.js';
import { createLogger } from './storage/logger.js';
import { type BotInstance, createBot } from './telegram/bot.js';
import { createMessageHandler } from './telegram/messageHandler.js';
import { sendSafeMessage } from './telegram/sender.js';
import { startTypingIndicator } from './telegram/typingIndicator.js';
import { parseMessage } from './telegram/updateParser.js';

export type App = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export type CreateAppOptions = {
  configPath?: string;
  envPath?: string;
  overrides?: {
    loadConfig?: (options: LoadConfigOptions) => ResolvedConfig;
    createDatabase?: (databasePath: string) => Database.Database;
    createLogger?: typeof createLogger;
    createCharacterStore?: (options: {
      db: Database.Database;
      directory: string;
      defaultName: string;
      hotReload: boolean;
    }) => CharacterStore;
    createRateLimiter?: typeof createRateLimiter;
    createRequestQueue?: typeof createRequestQueue;
    createGuardrailsService?: typeof createGuardrailsService;
    createBot?: typeof createBot;
    createHealthServer?: typeof createHealthServer;
    readSystemPrompt?: (filePath: string, encoding?: string) => string;
    callLlm?: typeof CallLlmType;
  };
};

export function createApp(options?: CreateAppOptions): App {
  const startTime = Date.now();
  const getUptimeSeconds = () => Math.floor((Date.now() - startTime) / 1000);

  let db: Database.Database | undefined;
  let botInstance: BotInstance | undefined;
  let healthServer: HealthServer | undefined;

  return {
    start: async () => {
      const loadConfigFn = options?.overrides?.loadConfig ?? loadConfig;
      const config = loadConfigFn({
        configPath:
          options?.configPath ?? process.env.CONFIG_PATH ?? 'config/production/config.yaml',
        envPath: options?.envPath,
      });

      const createDatabaseFn = options?.overrides?.createDatabase ?? createDatabase;
      db = createDatabaseFn(config.storage.databasePath);

      const secrets: string[] = [];
      if (config.secrets.telegramBotToken) secrets.push(config.secrets.telegramBotToken);
      if (config.llm.apiKey) secrets.push(config.llm.apiKey);
      if (config.guardrails.apiKey) secrets.push(config.guardrails.apiKey);

      const createLoggerFn = options?.overrides?.createLogger ?? createLogger;
      const logger = createLoggerFn(db, {
        secrets,
        redactEnabled: config.logging.sqlite.redactSecrets,
      });

      const createCharacterStoreFn =
        options?.overrides?.createCharacterStore ?? ((opts) => new CharacterStore(opts));
      const characterStore = createCharacterStoreFn({
        db,
        directory: config.characters.directory,
        defaultName: config.characters.default,
        hotReload: config.characters.hotReload,
      });

      const rateLimiter = createRateLimiter(config.rateLimit);
      const requestQueue = createRequestQueue(config.queue);

      const callLlmFn = options?.overrides?.callLlm ?? callLlm;
      const guardrails = createGuardrailsService(config, logger, callLlmFn);

      const readSystemPromptFn = options?.overrides?.readSystemPrompt ?? fs.readFileSync;
      const systemPrompt = readSystemPromptFn(config.systemPrompt.file, 'utf-8') as string;

      const createBotFn = options?.overrides?.createBot ?? createBot;
      botInstance = await createBotFn({
        token: config.secrets.telegramBotToken,
        mode: config.telegram.mode,
        webhookConfig:
          config.telegram.mode === 'webhook'
            ? {
                publicUrl: config.telegram.webhook.publicUrl ?? '',
                path: config.telegram.webhook.path,
                secretToken: config.telegram.webhook.secretToken,
              }
            : undefined,
        handleUpdate: async (update: Update) => {
          if (!update.message || !botInstance) return;
          const event = parseMessage(update.message, {
            allowedChatId: Number(config.telegram.allowedChatId),
            adminUserId: Number(config.telegram.adminUserId),
            botUsername: botInstance.botUsername,
            botId: botInstance.botId,
          });

          const handler = createMessageHandler({
            config,
            rateLimiter,
            requestQueue,
            guardrails,
            characterStore,
            buildPrompt,
            mapLlmRequest: mapRequest,
            callLlm: callLlmFn,
            sendSafeMessage,
            startTypingIndicator,
            api: botInstance.api,
            logger,
            systemPrompt,
            unsupportedReplyText: 'I can only work with text messages for now.',
            rateLimitMessage: config.rateLimit.enabled
              ? 'Rate limit exceeded. Please try again later.'
              : '',
            queueTimeoutMessage: 'Request timed out. Please try again later.',
            queueFullMessage: 'The bot is too busy. Please try again later.',
            llmErrorMessage: 'Sorry, I encountered an error. Please try again later.',
            getUptimeSeconds,
          });

          await handler(event);
        },
        commands: config.commands,
        supportsWebSearch: config.llm.supportsWebSearch,
        logger: {
          warn: (msg) =>
            logger.logBotEvent({
              type: 'command_registration_warning',
              details: msg,
            }),
        },
      });

      if (config.http.enabled || config.telegram.mode === 'webhook') {
        const createHealthServerFn = options?.overrides?.createHealthServer ?? createHealthServer;

        let webhookHandler:
          | ((req: import('http').IncomingMessage, res: import('http').ServerResponse) => void)
          | undefined;
        if (config.telegram.mode === 'webhook') {
          const { webhookCallback } = await import('grammy');
          webhookHandler = webhookCallback(botInstance.grammYBot as import('grammy').Bot, 'http');
        }

        healthServer = createHealthServerFn({
          config,
          getUptimeSeconds,
          database: db,
          host: config.http.host,
          port: config.http.port,
          healthPath: config.http.healthPath,
          webhookPath: config.telegram.webhook.path,
          webhookHandler,
        });
        await healthServer.start();
      }

      // Start bot (non-blocking in polling, sets webhook in webhook mode)
      await botInstance.start();
    },
    stop: async () => {
      if (botInstance) {
        await botInstance.stop();
      }
      if (healthServer) {
        await healthServer.stop();
      }
      if (db) {
        db.close();
      }
    },
  };
}
