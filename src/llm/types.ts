export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type MappedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

export type LlmResponse = {
  text: string;
  sources?: Array<{ title: string; url: string }>;
};

export type MapRequestOptions = {
  messages: LlmMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
  webSearch?: boolean;
  guardrails?: boolean;
};
