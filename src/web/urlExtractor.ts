const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION_PATTERN = /[),.!?:;\]}]+$/;

export function extractUrls(text: string): Set<string> {
  const urls = new Set<string>();

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION_PATTERN, '');
    if (url.length > 0) {
      urls.add(url);
    }
  }

  return urls;
}
