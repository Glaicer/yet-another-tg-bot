import type { ResolvedConfig } from '../config/types.js';

export function getProviderConfig(config: ResolvedConfig) {
  const provider = config.llm.provider;
  const providerConfig = config.providers[provider];
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return providerConfig;
}

export function supportsResponsesApi(config: ResolvedConfig): boolean {
  const provider = config.llm.provider;
  if (provider === 'opencode_go') {
    return false;
  }
  const pc = getProviderConfig(config);
  if (pc.supportsResponsesApi === true) return true;
  if (pc.supportsResponsesApi === false) return false;
  return false;
}

export function supportsChatCompletionsApi(config: ResolvedConfig): boolean {
  const provider = config.llm.provider;
  if (provider === 'opencode_go') {
    return true;
  }
  const pc = getProviderConfig(config);
  if (pc.supportsChatCompletionsApi === true) return true;
  if (pc.supportsChatCompletionsApi === false) return false;
  return true;
}

export function supportsReasoningEffort(config: ResolvedConfig): boolean {
  const pc = getProviderConfig(config);
  if (pc.supportsReasoningEffort === true) return true;
  if (pc.supportsReasoningEffort === false) return false;
  return false;
}

export function isLegacyOnlineSuffixEnabled(config: ResolvedConfig): boolean {
  const pc = getProviderConfig(config);
  return pc.legacyOnlineSuffix ?? false;
}

export function assertApiModeSupported(config: ResolvedConfig): void {
  const provider = config.llm.provider;
  if (provider === 'opencode_go' && config.llm.apiMode === 'responses') {
    throw new Error('OpenCode Go does not support Responses API');
  }
}
