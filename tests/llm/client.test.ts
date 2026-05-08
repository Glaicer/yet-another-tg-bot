import { describe, expect, it, vi } from 'vitest';
import { callLlm } from '../../src/llm/client.js';
import type { MappedRequest } from '../../src/llm/types.js';

function mockFetch(response: Response) {
  return vi.fn().mockResolvedValue(response);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('callLlm', () => {
  const baseRequest: MappedRequest = {
    url: 'https://api.test.com/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer key',
    },
    body: { model: 'gpt-4', messages: [] },
  };

  it('calls fetch with correct parameters', async () => {
    const fetchMock = mockFetch(jsonResponse({ choices: [{ message: { content: 'OK' } }] }));
    globalThis.fetch = fetchMock;

    await callLlm(baseRequest, 5000);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer key',
        },
        body: JSON.stringify(baseRequest.body),
      }),
    );
  });

  it('returns text from chat completions response', async () => {
    globalThis.fetch = mockFetch(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Hello there' } }],
      }),
    );

    const result = await callLlm(baseRequest, 5000);
    expect(result.text).toBe('Hello there');
  });

  it('returns text from responses API format', async () => {
    globalThis.fetch = mockFetch(
      jsonResponse({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Responses output' }],
          },
        ],
      }),
    );

    const result = await callLlm(baseRequest, 5000);
    expect(result.text).toBe('Responses output');
  });

  it('extracts sources from responses API annotations', async () => {
    globalThis.fetch = mockFetch(
      jsonResponse({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Here is info',
                annotations: [
                  {
                    type: 'url_citation',
                    title: 'Example',
                    url: 'https://example.com',
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const result = await callLlm(baseRequest, 5000);
    expect(result.text).toBe('Here is info');
    expect(result.sources).toEqual([{ title: 'Example', url: 'https://example.com' }]);
  });

  it('returns empty text for malformed response', async () => {
    globalThis.fetch = mockFetch(jsonResponse({ foo: 'bar' }));
    const result = await callLlm(baseRequest, 5000);
    expect(result.text).toBe('');
  });

  it('returns empty text when choices is empty', async () => {
    globalThis.fetch = mockFetch(jsonResponse({ choices: [] }));
    const result = await callLlm(baseRequest, 5000);
    expect(result.text).toBe('');
  });

  it('returns empty text when message content is missing', async () => {
    globalThis.fetch = mockFetch(jsonResponse({ choices: [{ message: { role: 'assistant' } }] }));
    const result = await callLlm(baseRequest, 5000);
    expect(result.text).toBe('');
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = mockFetch(jsonResponse({ error: 'bad' }, 400));
    await expect(callLlm(baseRequest, 5000)).rejects.toThrow(/LLM request failed: 400/);
  });

  it('throws on timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
        setTimeout(() => reject(new Error('Should have been aborted')), 10000);
      });
    });

    await expect(callLlm(baseRequest, 10)).rejects.toThrow(/timed out/);
  });

  it('does not leak api key in error messages', async () => {
    globalThis.fetch = mockFetch(jsonResponse({ error: 'unauthorized' }, 401));
    try {
      await callLlm(baseRequest, 5000);
    } catch (err) {
      if (err instanceof Error) {
        expect(err.message).not.toContain('key');
      }
    }
  });
});
