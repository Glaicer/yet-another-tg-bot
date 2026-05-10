import { Bot } from 'grammy';
import type { Update } from 'grammy/types';

export type BotApi = {
  sendMessage(params: {
    chat_id: number;
    text: string;
    parse_mode?: string;
    message_thread_id?: number;
  }): Promise<unknown>;
  sendChatAction(params: {
    chat_id: number;
    action: string;
    message_thread_id?: number;
  }): Promise<unknown>;
};

export type BotInstance = {
  grammYBot: unknown;
  botUsername: string;
  botId: number;
  api: BotApi;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export type GrammYBotLike = {
  init(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  api: {
    getMe(): Promise<{ id: number; username?: string }>;
    setMyCommands(
      commands: Array<{ command: string; description: string }>,
      options?: {
        scope: {
          type: 'all_group_chats' | 'all_private_chats';
        };
      },
    ): Promise<unknown>;
    sendMessage(chatId: number, text: string, options?: Record<string, unknown>): Promise<unknown>;
    sendChatAction(
      chatId: number,
      action: string,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
    setWebhook(url: string, options?: Record<string, unknown>): Promise<unknown>;
    deleteWebhook(): Promise<unknown>;
  };
  botInfo?: { id: number; username?: string };
  on(event: string, handler: (ctx: { update: unknown }) => void | Promise<void>): void;
};

export type CreateBotDeps = {
  createGrammYBot?: (token: string) => GrammYBotLike;
  token: string;
  mode: 'polling' | 'webhook';
  webhookConfig?: {
    publicUrl: string;
    path: string;
    secretToken?: string;
  };
  handleUpdate: (update: Update) => Promise<void>;
  commands: {
    registerOnStartup: boolean;
    group: Array<{ command: string; description: string }>;
    adminPrivate: Array<{ command: string; description: string }>;
  };
  supportsWebSearch: boolean;
  logger: { warn: (msg: string) => void };
};

export async function createBot(deps: CreateBotDeps): Promise<BotInstance> {
  const createGrammYBot =
    deps.createGrammYBot ?? ((token: string) => new Bot(token) as GrammYBotLike);
  const bot = createGrammYBot(deps.token);

  await bot.init();

  const botUsername = bot.botInfo?.username ?? '';
  const botId = bot.botInfo?.id ?? 0;

  const api: BotApi = {
    sendMessage: async (params) => {
      await bot.api.sendMessage(params.chat_id, params.text, {
        parse_mode: params.parse_mode,
        message_thread_id: params.message_thread_id,
      });
    },
    sendChatAction: async (params) => {
      await bot.api.sendChatAction(params.chat_id, params.action, {
        message_thread_id: params.message_thread_id,
      });
    },
  };

  bot.on('message', async (ctx) => {
    await deps.handleUpdate(ctx.update as Update);
  });

  if (deps.commands.registerOnStartup) {
    const groupCommands = deps.commands.group
      .filter((c) => c.command !== 'search' || deps.supportsWebSearch)
      .map((c) => ({ command: c.command, description: c.description }));
    const adminPrivateCommands = deps.commands.adminPrivate.map((c) => ({
      command: c.command,
      description: c.description,
    }));

    try {
      await bot.api.setMyCommands(groupCommands, { scope: { type: 'all_group_chats' } });
      await bot.api.setMyCommands(adminPrivateCommands, { scope: { type: 'all_private_chats' } });
    } catch (error) {
      deps.logger.warn(
        `Command registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const start = async () => {
    if (deps.mode === 'polling') {
      await bot.start();
    } else if (deps.mode === 'webhook') {
      if (!deps.webhookConfig) {
        throw new Error('Webhook config is required for webhook mode');
      }
      await bot.api.setWebhook(`${deps.webhookConfig.publicUrl}${deps.webhookConfig.path}`, {
        secret_token: deps.webhookConfig.secretToken,
      });
    }
  };

  const stop = async () => {
    await bot.stop();
    if (deps.mode === 'webhook') {
      await bot.api.deleteWebhook();
    }
  };

  return { grammYBot: bot, botUsername, botId, api, start, stop };
}
