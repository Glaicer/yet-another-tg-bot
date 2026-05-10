import { describe, expect, it } from 'vitest';
import { extractUrls } from '../../src/web/urlExtractor.js';

describe('extractUrls', () => {
  it('returns unique http and https URLs from message text', () => {
    const urls = extractUrls(
      'Read https://example.com/a and http://example.org?q=1, then https://example.com/a',
    );

    expect(urls).toEqual(new Set(['https://example.com/a', 'http://example.org?q=1']));
  });

  it('trims common sentence punctuation from detected URLs', () => {
    const urls = extractUrls('Check this (https://example.com/page). And https://foo.test/x!');

    expect(urls).toEqual(new Set(['https://example.com/page', 'https://foo.test/x']));
  });
});
