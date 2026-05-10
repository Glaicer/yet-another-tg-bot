import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFirecrawlClient } from '../../src/web/firecrawlClient.js';

describe('createFirecrawlClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('scrapes a URL through Firecrawl and returns markdown', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          markdown: '# Example\n\nPage body',
          metadata: { title: 'Example', sourceURL: 'https://example.com' },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createFirecrawlClient({ apiKey: 'fc-test' });

    const page = await client.scrape('https://example.com');

    expect(fetchMock).toHaveBeenCalledWith('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fc-test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://example.com',
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });
    expect(page).toEqual({
      url: 'https://example.com',
      markdown: '# Example\n\nPage body',
      title: 'Example',
    });
  });

  it('throws when Firecrawl does not return markdown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, data: {} }),
      }),
    );
    const client = createFirecrawlClient({ apiKey: 'fc-test' });

    await expect(client.scrape('https://example.com')).rejects.toThrow(
      'Firecrawl response did not include markdown',
    );
  });
});
