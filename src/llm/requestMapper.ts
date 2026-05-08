import type { ResolvedConfig } from '../config/types.js';
import {
  assertApiModeSupported,
  isLegacyOnlineSuffixEnabled,
  supportsReasoningEffort,
  supportsResponsesApi,
} from './providerCapabilities.js';
import type { MapRequestOptions, MappedRequest } from './types.js';

export function mapRequest(config: ResolvedConfig, options: MapRequestOptions): MappedRequest {
  assertApiModeSupported(config);

  const apiMode = config.llm.apiMode;
  const isResponses = apiMode === 'responses' && supportsResponsesApi(config);
  const supportsReasoning = supportsReasoningEffort(config);

  let url: string;
  if (isResponses && supportsResponsesApi(config)) {
    url = `${config.llm.baseUrl}/responses`;
  } else {
    url = `${config.llm.baseUrl}/chat/completions`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.llm.apiKey}`,
  };

  const body: Record<string, unknown> = {
    model: options.model,
    temperature: options.temperature,
  };

  if (options.maxTokens > 0) {
    body.max_tokens = options.maxTokens;
  }

  if (!options.guardrails) {
    if (isResponses && supportsReasoning) {
      body.reasoning = { effort: config.llm.reasoningEffort };
    } else if (!isResponses && supportsReasoning) {
      body.reasoning_effort = config.llm.reasoningEffort;
    }
  }

  if (isResponses) {
    body.input = options.messages;
  } else {
    body.messages = options.messages;
  }

  if (options.webSearch) {
    const webSearchMode = config.llm.webSearch.mode;
    if (webSearchMode === 'openai_tool') {
      body.tools = [{ type: 'web_search_preview' }];
    } else if (webSearchMode === 'openrouter_server_tool') {
      body.tools = [{ type: 'openrouter:web_search' }];
    } else if (
      webSearchMode === 'openrouter_online_legacy' &&
      isLegacyOnlineSuffixEnabled(config)
    ) {
      body.model = `${options.model}:online`;
    }
  }

  return { url, headers, body };
}
