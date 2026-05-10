import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loadConfig.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
}

function writeYaml(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

function setupFiles(dir: string) {
  const promptsDir = path.join(dir, 'prompts');
  const charsDir = path.join(dir, 'characters');
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.mkdirSync(charsDir, { recursive: true });
  fs.writeFileSync(path.join(promptsDir, 'system.md'), '# System prompt', 'utf-8');
  fs.writeFileSync(path.join(charsDir, 'default.md'), '# Default character', 'utf-8');
  fs.writeFileSync(path.join(charsDir, 'other.md'), '# Other character', 'utf-8');
  return { promptsDir, charsDir };
}

function baseYaml(opts?: {
  overrides?: string;
  selectedCharacter?: string;
  mode?: string;
  apiMode?: string;
  reasoningEffort?: string;
  webhook?: string;
  guardrailsEnabled?: boolean;
}): string {
  const selected = opts?.selectedCharacter ?? 'default';
  const mode = opts?.mode ?? 'polling';
  const apiMode = opts?.apiMode ?? 'responses';
  const reasoningEffort = opts?.reasoningEffort ?? 'none';
  const webhook = opts?.webhook ?? '';
  const guardrails = opts?.guardrailsEnabled !== false;
  return `
app:
  environment: production
  logLevel: info

telegram:
  mode: ${mode}
  allowedChatIdEnv: TELEGRAM_ALLOWED_CHAT_ID
  adminUserIdEnv: TELEGRAM_ADMIN_USER_ID
  typingIndicator:
    enabled: true
    intervalMs: 4500
  webhook:
    publicUrl: null
    path: /telegram/webhook
    secretTokenEnv: TELEGRAM_WEBHOOK_SECRET
${webhook}

http:
  enabled: true
  host: 0.0.0.0
  port: 3000
  healthPath: /healthz

storage:
  type: sqlite
  databasePathEnv: SQLITE_DATABASE_PATH

systemPrompt:
  file: ${opts?.overrides ?? 'PROMPTS_DIR/system.md'}

characters:
  directory: ${opts?.overrides ?? 'CHARS_DIR'}
  default: default
  selected: ${selected}
  hotReload: true

llm:
  provider: openai
  apiMode: ${apiMode}
  apiKeyEnv: MAIN_LLM_API_KEY
  baseUrl: https://api.openai.com/v1
  model: gpt-5.5-mini
  temperature: 0.7
  maxTokens: 800
  reasoningEffort: ${reasoningEffort}
  supportsWebSearch: true
  webSearch:
    mode: openai_tool
    maxResults: 5
    requireCitations: true

providers:
  openai:
    type: openai-compatible
    supportsResponsesApi: true
    supportsChatCompletionsApi: true
    supportsReasoningEffort: true
    webSearchMode: openai_tool

  openrouter:
    type: openai-compatible
    supportsResponsesApi: true
    supportsChatCompletionsApi: true
    supportsReasoningEffort: provider-dependent
    webSearchMode: openrouter_server_tool
    legacyOnlineSuffix: true

  opencode_go:
    type: openai-compatible
    supportsResponsesApi: unknown
    supportsChatCompletionsApi: unknown
    supportsReasoningEffort: provider-dependent
    webSearchMode: none

  ollama_cloud:
    type: openai-compatible
    supportsResponsesApi: unknown
    supportsChatCompletionsApi: true
    supportsReasoningEffort: false
    webSearchMode: none

guardrails:
  enabled: ${guardrails}
  failOpenOnProviderError: true
  provider: openai-compatible
  apiKeyEnv: GUARDRAILS_API_KEY
  baseUrl: https://example.com/v1
  model: llama-guard-4-12b
  timeoutMs: 8000
  refusalMessage: "I can't help with that request."
  checkInput: true
  checkOutput: false
  blockPromptInjection: true

rateLimit:
  enabled: true
  perUser:
    windowMs: 60000
    maxRequests: 5
  perChat:
    windowMs: 60000
    maxRequests: 20

queue:
  enabled: true
  maxConcurrentRequests: 2
  maxQueueSize: 20
  timeoutMs: 60000

timeouts:
  llmRequestMs: 60000
  telegramSendMs: 10000

commands:
  registerOnStartup: true
  group:
    - command: help
      description: Bot help
    - command: search
      description: Fact-checking with sources
  adminPrivate:
    - command: status
      description: Bot status
    - command: personas
      description: List personas
    - command: persona
      description: Select persona

logging:
  sqlite:
    enabled: true
    logMessages: false
    redactSecrets: true

messages:
  unsupportedReply: "I can only work with text messages for now."
  rateLimitExceeded: "Rate limit exceeded. Please try again later."
  queueTimeout: "Request timed out. Please try again later."
  queueFull: "The bot is too busy. Please try again later."
  llmError: "Sorry, I encountered an error. Please try again later."
  helpText: "How to use this bot"
  helpSearchHint: "• Use /search <instruction> to search the web"
  searchEmptyArgs: "Please provide a search instruction: /search <instruction>"
  personasAvailable: "Available personas:\\n\\n{list}"
  personasEmpty: "No personas available."
  personaMissingName: "Please provide a persona name: /persona <name>"
  personaUnknown: "Unknown persona: {name}. Use /personas to see available personas."
  personaChanged: "Persona changed to: {name}"
  statusTitle: "Status"
`;
}

describe('loadConfig', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    process.env = {
      ...originalEnv,
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ALLOWED_CHAT_ID: '-1001234567890',
      TELEGRAM_ADMIN_USER_ID: '12345',
      MAIN_LLM_API_KEY: 'test-llm-key',
      GUARDRAILS_API_KEY: 'test-guard-key',
      SQLITE_DATABASE_PATH: path.join(tempDir, 'data', 'bot.sqlite'),
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads and validates a valid config', () => {
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    const config = loadConfig({ configPath });

    expect(config.telegram.mode).toBe('polling');
    expect(config.telegram.allowedChatId).toBe('-1001234567890');
    expect(config.telegram.adminUserId).toBe('12345');
    expect(config.llm.apiKey).toBe('test-llm-key');
    expect(config.storage.databasePath).toBe(path.join(tempDir, 'data', 'bot.sqlite'));
    expect(config.characters.default).toBe('default');
    expect(config.characters.selected).toBe('default');
    expect(config.guardrails.enabled).toBe(true);
    expect(config.guardrails.apiKey).toBe('test-guard-key');
    expect(config.app.logLevel).toBe('info');
    expect(config.llm.apiMode).toBe('responses');
    expect(config.llm.reasoningEffort).toBe('none');
  });

  it('loads optional Firecrawl API key from environment when present', () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key';
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    const config = loadConfig({ configPath });

    expect(config.firecrawl).toEqual({
      apiKey: 'fc-test-key',
      baseUrl: 'https://api.firecrawl.dev',
    });
  });

  it('throws when config file does not exist', () => {
    expect(() => loadConfig({ configPath: path.join(tempDir, 'missing.yaml') })).toThrow(
      /config file/i,
    );
  });

  it('throws when TELEGRAM_BOT_TOKEN is missing', () => {
    process.env.TELEGRAM_BOT_TOKEN = undefined;
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/TELEGRAM_BOT_TOKEN/i);
  });

  it('throws when TELEGRAM_ALLOWED_CHAT_ID is missing', () => {
    process.env.TELEGRAM_ALLOWED_CHAT_ID = undefined;
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/TELEGRAM_ALLOWED_CHAT_ID/i);
  });

  it('throws when TELEGRAM_ADMIN_USER_ID is missing', () => {
    process.env.TELEGRAM_ADMIN_USER_ID = undefined;
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/TELEGRAM_ADMIN_USER_ID/i);
  });

  it('throws when MAIN_LLM_API_KEY is missing', () => {
    process.env.MAIN_LLM_API_KEY = undefined;
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/MAIN_LLM_API_KEY/i);
  });

  it('throws when GUARDRAILS_API_KEY is missing and guardrails are enabled', () => {
    process.env.GUARDRAILS_API_KEY = undefined;
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/GUARDRAILS_API_KEY/i);
  });

  it('does not throw when GUARDRAILS_API_KEY is missing and guardrails are disabled', () => {
    process.env.GUARDRAILS_API_KEY = undefined;
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml({ guardrailsEnabled: false })
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    const config = loadConfig({ configPath });
    expect(config.guardrails.enabled).toBe(false);
    expect(config.guardrails.apiKey).toBeUndefined();
  });

  it('throws when SQLITE_DATABASE_PATH is missing', () => {
    process.env.SQLITE_DATABASE_PATH = undefined;
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/SQLITE_DATABASE_PATH/i);
  });

  it('throws when SQLite parent directory does not exist and cannot be created', () => {
    // Create a read-only directory so nested mkdirSync fails
    const roDir = path.join(tempDir, 'readonly');
    fs.mkdirSync(roDir, { mode: 0o555 });
    const badPath = path.join(roDir, 'nested', 'bot.sqlite');
    process.env.SQLITE_DATABASE_PATH = badPath;
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/SQLite/i);
  });

  it('throws on invalid apiMode', () => {
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml({ apiMode: 'invalid_mode' })
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/apiMode/i);
  });

  it('throws on invalid reasoningEffort', () => {
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml({ reasoningEffort: 'extreme' })
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/reasoningEffort/i);
  });

  it('throws on invalid telegram mode', () => {
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml({ mode: 'socket' })
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/mode/i);
  });

  it('throws when system prompt file does not exist', () => {
    const { charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, path.join(tempDir, 'missing'))
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/system prompt/i);
  });

  it('throws when characters directory does not exist', () => {
    const { promptsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, path.join(tempDir, 'missing_chars'));
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/characters directory/i);
  });

  it('throws when default character file does not exist', () => {
    const { promptsDir, charsDir } = setupFiles(tempDir);
    fs.unlinkSync(path.join(charsDir, 'default.md'));
    const yamlContent = baseYaml()
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/default character/i);
  });

  it('falls back to default when selected character does not exist', () => {
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml({ selectedCharacter: 'missing' })
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    const config = loadConfig({ configPath });
    expect(config.characters.selected).toBe('default');
    expect(config.characters.fallback).toBe(true);
  });

  it('validates webhook config when mode is webhook', () => {
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml({ mode: 'webhook' })
      .replace(/publicUrl: null/, 'publicUrl: https://example.com/webhook')
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    const config = loadConfig({ configPath });
    expect(config.telegram.mode).toBe('webhook');
    expect(config.telegram.webhook.publicUrl).toBe('https://example.com/webhook');
    expect(config.telegram.webhook.secretToken).toBe('webhook-secret');
  });

  it('succeeds in polling mode without TELEGRAM_WEBHOOK_SECRET', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = undefined;
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml({ mode: 'polling' })
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    const config = loadConfig({ configPath });
    expect(config.telegram.mode).toBe('polling');
    expect(config.telegram.webhook.secretToken).toBeUndefined();
  });

  it('throws when webhook mode has null publicUrl', () => {
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml({ mode: 'webhook' })
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    expect(() => loadConfig({ configPath })).toThrow(/publicUrl/i);
  });

  it('loads config with chat_completions apiMode', () => {
    const { promptsDir, charsDir } = setupFiles(tempDir);
    const yamlContent = baseYaml({ apiMode: 'chat_completions' })
      .replace(/PROMPTS_DIR/g, promptsDir)
      .replace(/CHARS_DIR/g, charsDir);
    const configPath = writeYaml(tempDir, 'config.yaml', yamlContent);

    const config = loadConfig({ configPath });
    expect(config.llm.apiMode).toBe('chat_completions');
  });

  it('loads config with various reasoningEffort values', () => {
    const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    for (const effort of efforts) {
      const { promptsDir, charsDir } = setupFiles(tempDir);
      const yamlContent = baseYaml({ reasoningEffort: effort })
        .replace(/PROMPTS_DIR/g, promptsDir)
        .replace(/CHARS_DIR/g, charsDir);
      const configPath = writeYaml(tempDir, `config-${effort}.yaml`, yamlContent);

      const config = loadConfig({ configPath });
      expect(config.llm.reasoningEffort).toBe(effort);
      fs.rmSync(promptsDir, { recursive: true, force: true });
      fs.rmSync(charsDir, { recursive: true, force: true });
    }
  });
});
