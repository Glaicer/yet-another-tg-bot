import type { LlmResponse, MappedRequest } from './types.js';

export async function callLlm(request: MappedRequest, timeoutMs: number): Promise<LlmResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const safeUrl = request.url;
      throw new Error(`LLM request failed: ${response.status} ${safeUrl}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return extractResponse(data);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs}ms`);
    }
    if (error instanceof Error && error.message.startsWith('LLM request failed')) {
      throw error;
    }
    throw new Error(
      `LLM request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function extractResponse(data: Record<string, unknown>): LlmResponse {
  // Try Chat Completions format first
  if (Array.isArray(data.choices)) {
    const choice = data.choices[0] as { message?: { content?: string } } | undefined;
    if (choice?.message?.content) {
      return { text: choice.message.content };
    }
    return { text: '' };
  }

  // Try Responses API format
  if (Array.isArray(data.output)) {
    const output = data.output as Array<{
      type?: string;
      role?: string;
      content?: Array<{
        type?: string;
        text?: string;
        annotations?: Array<{
          type?: string;
          title?: string;
          url?: string;
        }>;
      }>;
    }>;

    const message = output.find((o) => o.type === 'message' && o.role === 'assistant');
    if (message?.content) {
      const textItem = message.content.find((c) => c.type === 'output_text');
      if (textItem?.text) {
        const sources: Array<{ title: string; url: string }> = [];
        if (textItem.annotations) {
          for (const ann of textItem.annotations) {
            if (ann.type === 'url_citation' && ann.title && ann.url) {
              sources.push({ title: ann.title, url: ann.url });
            }
          }
        }
        return { text: textItem.text, sources: sources.length > 0 ? sources : undefined };
      }
    }
  }

  return { text: '' };
}
