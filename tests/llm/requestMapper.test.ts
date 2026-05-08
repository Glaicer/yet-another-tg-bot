import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '../../src/config/types.js';
import { mapRequest } from '../../src/llm/requestMapper.js';
import type { LlmMessage } from '../../src/llm/types.js';

function makeConfig(opts?: {
  provider?: string;
  apiMode?: 'responses' | 'chat_completions';
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  supportsReasoning?: boolean | 'provider-dependent';
  webSearchMode?: 'openai_tool' | 'openrouter_server_tool' | 'openrouter_online_legacy' | 'none';
  legacyOnlineSuffix?: boolean;
  supportsResponses?: boolean | 'unknown';
  supportsChatCompletions?: boolean | 'unknown';
}): ResolvedConfig {
  const provider = opts?.provider ?? 'openai';
  return {
    app: { environment: 'test', logLevel: 'info' },
    telegram: {
      mode: 'polling',
      allowedChatId: '-1',
      adminUserId: '1',
      typingIndicator: { enabled: true, intervalMs: 4500 },
      webhook: { publicUrl: null, path: '/webhook' },
    },
    http: { enabled: true, host: '0.0.0.0', port: 3000, healthPath: '/healthz' },
    storage: { type: 'sqlite', databasePath: ':memory:' },
    systemPrompt: { file: 'system.md' },
    characters: {
      directory: 'chars',
      default: 'default',
      selected: 'default',
      hotReload: false,
      fallback: false,
    },
    llm: {
      provider,
      apiMode: opts?.apiMode ?? 'responses',
      apiKey: 'test-key',
      baseUrl: 'https://api.test.com/v1',
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 800,
      reasoningEffort: opts?.reasoningEffort ?? 'none',
      supportsWebSearch: true,
      webSearch: {
        mode: opts?.webSearchMode ?? 'none',
        maxResults: 5,
        requireCitations: true,
      },
    },
    providers: {
      [provider]: {
        type: 'openai-compatible',
        supportsResponsesApi: opts?.supportsResponses ?? true,
        supportsChatCompletionsApi: opts?.supportsChatCompletions ?? true,
        supportsReasoningEffort: opts?.supportsReasoning ?? true,
        webSearchMode: opts?.webSearchMode ?? 'none',
        legacyOnlineSuffix: opts?.legacyOnlineSuffix,
      },
    },
    guardrails: {
      enabled: false,
      failOpenOnProviderError: true,
      provider: 'openai',
      baseUrl: 'https://guard.test.com/v1',
      model: 'guard-model',
      timeoutMs: 5000,
      refusalMessage: 'Nope',
      checkInput: true,
      checkOutput: false,
      blockPromptInjection: true,
    },
    rateLimit: {
      enabled: false,
      perUser: { windowMs: 60000, maxRequests: 5 },
      perChat: { windowMs: 60000, maxRequests: 20 },
    },
    queue: {
      enabled: false,
      maxConcurrentRequests: 1,
      maxQueueSize: 10,
      timeoutMs: 30000,
    },
    timeouts: { llmRequestMs: 30000, telegramSendMs: 10000 },
    commands: { registerOnStartup: false, group: [], adminPrivate: [] },
    logging: {
      sqlite: { enabled: false, logMessages: false, redactSecrets: true },
    },
    secrets: { telegramBotToken: 'token' },
  };
}

const baseMessages: LlmMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello' },
];

describe('mapRequest', () => {
  it('maps to Responses API with correct URL and headers', () => {
    const config = makeConfig({ apiMode: 'responses' });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.url).toBe('https://api.test.com/v1/responses');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers.Authorization).toBe('Bearer test-key');
  });

  it('maps to Chat Completions API with correct URL', () => {
    const config = makeConfig({ apiMode: 'chat_completions' });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.url).toBe('https://api.test.com/v1/chat/completions');
  });

  it('includes temperature and max_tokens', () => {
    const config = makeConfig({ apiMode: 'responses' });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.body.temperature).toBe(0.5);
    expect(req.body.max_tokens).toBe(100);
  });

  it('includes reasoning.effort for Responses API when supported', () => {
    const config = makeConfig({
      apiMode: 'responses',
      reasoningEffort: 'high',
      supportsReasoning: true,
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.body.reasoning).toEqual({ effort: 'high' });
  });

  it('includes explicit reasoning none for Responses API when supported', () => {
    const config = makeConfig({
      apiMode: 'responses',
      reasoningEffort: 'none',
      supportsReasoning: true,
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.body.reasoning).toEqual({ effort: 'none' });
  });

  it('omits reasoning for Responses API when unsupported', () => {
    const config = makeConfig({
      apiMode: 'responses',
      reasoningEffort: 'high',
      supportsReasoning: false,
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.body.reasoning).toBeUndefined();
  });

  it('includes reasoning_effort for Chat Completions when supported', () => {
    const config = makeConfig({
      apiMode: 'chat_completions',
      reasoningEffort: 'medium',
      supportsReasoning: true,
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.body.reasoning_effort).toBe('medium');
  });

  it('omits reasoning_effort for Chat Completions when unsupported', () => {
    const config = makeConfig({
      apiMode: 'chat_completions',
      reasoningEffort: 'medium',
      supportsReasoning: false,
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.body.reasoning_effort).toBeUndefined();
  });

  it('throws for OpenCode Go with Responses API', () => {
    const config = makeConfig({
      provider: 'opencode_go',
      apiMode: 'responses',
      supportsResponses: 'unknown',
      supportsChatCompletions: 'unknown',
    });
    expect(() =>
      mapRequest(config, {
        messages: baseMessages,
        model: 'model',
        temperature: 0.5,
        maxTokens: 100,
      }),
    ).toThrow(/OpenCode Go does not support Responses API/i);
  });

  it('does not throw for OpenCode Go with Chat Completions', () => {
    const config = makeConfig({
      provider: 'opencode_go',
      apiMode: 'chat_completions',
      supportsResponses: 'unknown',
      supportsChatCompletions: 'unknown',
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'model',
      temperature: 0.5,
      maxTokens: 100,
    });
    expect(req.url).toBe('https://api.test.com/v1/chat/completions');
  });

  it('includes OpenAI web search tool for Responses API', () => {
    const config = makeConfig({
      apiMode: 'responses',
      webSearchMode: 'openai_tool',
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
      webSearch: true,
    });

    expect(req.body.tools).toEqual([{ type: 'web_search_preview' }]);
  });

  it('includes OpenRouter modern web search tool for Chat Completions', () => {
    const config = makeConfig({
      provider: 'openrouter',
      apiMode: 'chat_completions',
      webSearchMode: 'openrouter_server_tool',
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
      webSearch: true,
    });

    expect(req.body.tools).toEqual([{ type: 'openrouter:web_search' }]);
  });

  it('appends :online suffix for OpenRouter legacy mode', () => {
    const config = makeConfig({
      provider: 'openrouter',
      apiMode: 'chat_completions',
      webSearchMode: 'openrouter_online_legacy',
      legacyOnlineSuffix: true,
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
      webSearch: true,
    });

    expect(req.body.model).toBe('gpt-4:online');
  });

  it('does not append :online when legacy mode is disabled', () => {
    const config = makeConfig({
      provider: 'openrouter',
      apiMode: 'chat_completions',
      webSearchMode: 'openrouter_server_tool',
      legacyOnlineSuffix: false,
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
      webSearch: true,
    });

    expect(req.body.model).toBe('gpt-4');
  });

  it('does not include reasoning for guardrails requests', () => {
    const config = makeConfig({
      apiMode: 'responses',
      reasoningEffort: 'high',
      supportsReasoning: true,
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
      guardrails: true,
    });

    expect(req.body.reasoning).toBeUndefined();
    expect(req.body.reasoning_effort).toBeUndefined();
  });

  it('omits max_tokens when zero or negative', () => {
    const config = makeConfig({ apiMode: 'responses' });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 0,
    });

    expect(req.body.max_tokens).toBeUndefined();
  });

  it('maps messages correctly for Responses API', () => {
    const config = makeConfig({ apiMode: 'responses' });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.body.input).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('maps messages correctly for Chat Completions', () => {
    const config = makeConfig({ apiMode: 'chat_completions' });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('falls back to Chat Completions format when responses is unsupported', () => {
    const config = makeConfig({
      apiMode: 'responses',
      supportsResponses: false,
      supportsReasoning: true,
      reasoningEffort: 'medium',
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.url).toBe('https://api.test.com/v1/chat/completions');
    expect(req.body.messages).toEqual(baseMessages);
    expect(req.body.input).toBeUndefined();
    expect(req.body.reasoning_effort).toBe('medium');
    expect(req.body.reasoning).toBeUndefined();
  });

  it('does not include web search tools when webSearch is not set', () => {
    const config = makeConfig({
      apiMode: 'responses',
      webSearchMode: 'openai_tool',
    });
    const req = mapRequest(config, {
      messages: baseMessages,
      model: 'gpt-4',
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(req.body.tools).toBeUndefined();
  });
});
