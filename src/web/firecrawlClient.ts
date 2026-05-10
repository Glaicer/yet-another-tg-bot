export type FirecrawlPage = {
  url: string;
  markdown: string;
  title?: string;
};

export type FirecrawlClient = {
  scrape(url: string): Promise<FirecrawlPage>;
};

type FirecrawlClientOptions = {
  apiKey: string;
  baseUrl?: string;
};

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    markdown?: unknown;
    metadata?: {
      title?: unknown;
      sourceURL?: unknown;
    };
  };
  error?: unknown;
};

export function createFirecrawlClient(options: FirecrawlClientOptions): FirecrawlClient {
  const baseUrl = options.baseUrl ?? 'https://api.firecrawl.dev';

  return {
    scrape: async (url: string): Promise<FirecrawlPage> => {
      const response = await fetch(`${baseUrl}/v2/scrape`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Firecrawl request failed: ${response.status}`);
      }

      const body = (await response.json()) as FirecrawlScrapeResponse;
      if (body.success === false) {
        throw new Error(`Firecrawl scrape failed: ${String(body.error ?? 'unknown error')}`);
      }

      const markdown = body.data?.markdown;
      if (typeof markdown !== 'string' || markdown.trim() === '') {
        throw new Error('Firecrawl response did not include markdown');
      }

      const title = body.data?.metadata?.title;
      const sourceUrl = body.data?.metadata?.sourceURL;
      return {
        url: typeof sourceUrl === 'string' ? sourceUrl : url,
        markdown,
        title: typeof title === 'string' ? title : undefined,
      };
    },
  };
}
