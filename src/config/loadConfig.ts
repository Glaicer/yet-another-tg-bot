import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadEnv, requireEnv, resolveEnvVarRequired } from './env.js';
import { type RawConfig, rawConfigSchema } from './schema.js';
import type { ResolvedConfig } from './types.js';

export type LoadConfigOptions = {
  configPath: string;
  envPath?: string;
};

export function loadConfig(options: LoadConfigOptions): ResolvedConfig {
  loadEnv(options.envPath);

  if (!fs.existsSync(options.configPath)) {
    throw new Error(`Config file does not exist: ${options.configPath}`);
  }

  const rawContent = fs.readFileSync(options.configPath, 'utf-8');
  const parsed = YAML.parse(rawContent);

  let raw: RawConfig;
  try {
    raw = rawConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof Error && 'issues' in error) {
      const issues = (error as { issues: Array<{ path: (string | number)[]; message: string }> })
        .issues;
      const messages = issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Config validation failed:\n${messages.join('\n')}`);
    }
    throw error;
  }

  // Validate required env vars
  requireEnv('TELEGRAM_BOT_TOKEN');
  requireEnv('TELEGRAM_ALLOWED_CHAT_ID');
  requireEnv('TELEGRAM_ADMIN_USER_ID');
  requireEnv('MAIN_LLM_API_KEY');
  requireEnv('SQLITE_DATABASE_PATH');

  if (raw.guardrails.enabled) {
    requireEnv('GUARDRAILS_API_KEY');
  }

  // Resolve env-driven config values
  const allowedChatId = resolveEnvVarRequired(raw.telegram.allowedChatIdEnv);
  const adminUserId = resolveEnvVarRequired(raw.telegram.adminUserIdEnv);
  const databasePath = resolveEnvVarRequired(raw.storage.databasePathEnv);
  const apiKey = resolveEnvVarRequired(raw.llm.apiKeyEnv);
  const guardrailsApiKey = raw.guardrails.enabled
    ? resolveEnvVarRequired(raw.guardrails.apiKeyEnv)
    : undefined;

  // Validate SQLite parent directory exists or can be created
  const dbDir = path.dirname(databasePath);
  if (!fs.existsSync(dbDir)) {
    try {
      fs.mkdirSync(dbDir, { recursive: true });
    } catch {
      throw new Error(`SQLite parent directory does not exist and cannot be created: ${dbDir}`);
    }
  }

  // Validate system prompt file exists
  const systemPromptPath = path.resolve(raw.systemPrompt.file);
  if (!fs.existsSync(systemPromptPath)) {
    throw new Error(`System prompt file does not exist: ${systemPromptPath}`);
  }

  // Validate characters directory exists
  const charsDir = path.resolve(raw.characters.directory);
  if (!fs.existsSync(charsDir) || !fs.statSync(charsDir).isDirectory()) {
    throw new Error(`Characters directory does not exist: ${charsDir}`);
  }

  // Validate default character exists
  const defaultCharPath = path.join(charsDir, `${raw.characters.default}.md`);
  if (!fs.existsSync(defaultCharPath)) {
    throw new Error(`Default character file does not exist: ${defaultCharPath}`);
  }

  // Handle selected character fallback
  let selectedCharacter = raw.characters.selected;
  let fallback = false;
  const selectedCharPath = path.join(charsDir, `${selectedCharacter}.md`);
  if (!fs.existsSync(selectedCharPath)) {
    selectedCharacter = raw.characters.default;
    fallback = true;
  }

  // Validate webhook config when mode is webhook
  let webhookSecretToken: string | undefined;
  if (raw.telegram.mode === 'webhook') {
    if (!raw.telegram.webhook.publicUrl || raw.telegram.webhook.publicUrl === '') {
      throw new Error('Webhook mode requires a valid webhook publicUrl');
    }
    webhookSecretToken = resolveEnvVarRequired(raw.telegram.webhook.secretTokenEnv);
  }

  const resolved: ResolvedConfig = {
    app: raw.app,
    telegram: {
      mode: raw.telegram.mode,
      allowedChatId,
      adminUserId,
      typingIndicator: raw.telegram.typingIndicator,
      webhook: {
        publicUrl: raw.telegram.webhook.publicUrl,
        path: raw.telegram.webhook.path,
        secretToken: webhookSecretToken,
      },
    },
    http: raw.http,
    storage: {
      type: raw.storage.type,
      databasePath,
    },
    systemPrompt: raw.systemPrompt,
    characters: {
      directory: charsDir,
      default: raw.characters.default,
      selected: selectedCharacter,
      hotReload: raw.characters.hotReload,
      fallback,
    },
    llm: {
      provider: raw.llm.provider,
      apiMode: raw.llm.apiMode,
      apiKey,
      baseUrl: raw.llm.baseUrl,
      model: raw.llm.model,
      temperature: raw.llm.temperature,
      maxTokens: raw.llm.maxTokens,
      reasoningEffort: raw.llm.reasoningEffort,
      supportsWebSearch: raw.llm.supportsWebSearch,
      webSearch: raw.llm.webSearch,
    },
    providers: raw.providers,
    guardrails: {
      enabled: raw.guardrails.enabled,
      failOpenOnProviderError: raw.guardrails.failOpenOnProviderError,
      provider: raw.guardrails.provider,
      apiKey: guardrailsApiKey,
      baseUrl: raw.guardrails.baseUrl,
      model: raw.guardrails.model,
      timeoutMs: raw.guardrails.timeoutMs,
      refusalMessage: raw.guardrails.refusalMessage,
      checkInput: raw.guardrails.checkInput,
      checkOutput: raw.guardrails.checkOutput,
      blockPromptInjection: raw.guardrails.blockPromptInjection,
    },
    rateLimit: raw.rateLimit,
    queue: raw.queue,
    timeouts: raw.timeouts,
    commands: raw.commands,
    logging: raw.logging,
    messages: raw.messages,
    secrets: {
      telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    },
  };

  return resolved;
}
