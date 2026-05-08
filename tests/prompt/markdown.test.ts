import { describe, expect, it } from 'vitest';
import { escapeMarkdownV2 } from '../../src/prompt/markdown.js';

describe('escapeMarkdownV2', () => {
  it('escapes underscores', () => {
    expect(escapeMarkdownV2('hello_world')).toBe('hello\\_world');
  });

  it('escapes asterisks', () => {
    expect(escapeMarkdownV2('hello *world*')).toBe('hello \\*world\\*');
  });

  it('escapes brackets and parentheses', () => {
    expect(escapeMarkdownV2('[link](url)')).toBe('\\[link\\]\\(url\\)');
  });

  it('escapes tildes and backticks', () => {
    expect(escapeMarkdownV2('~text~ `code`')).toBe('\\~text\\~ \\`code\\`');
  });

  it('escapes all required MarkdownV2 special characters', () => {
    const input = '_ * [ ] ( ) ~ ` > # + - = | { } . !';
    const expected = '\\_ \\* \\[ \\] \\( \\) \\~ \\` \\> \\# \\+ \\- \\= \\| \\{ \\} \\. \\!';
    expect(escapeMarkdownV2(input)).toBe(expected);
  });

  it('escapes backslashes', () => {
    expect(escapeMarkdownV2('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('returns empty string for empty input', () => {
    expect(escapeMarkdownV2('')).toBe('');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeMarkdownV2('Hello world 123')).toBe('Hello world 123');
  });

  it('handles mixed text with newlines', () => {
    const input = 'Line 1\nLine_2\n* bullet';
    const expected = 'Line 1\nLine\\_2\n\\* bullet';
    expect(escapeMarkdownV2(input)).toBe(expected);
  });

  it('handles code-like content', () => {
    const input = 'Use `console.log()`';
    const expected = 'Use \\`console.log()\\`';
    expect(escapeMarkdownV2(input)).toBe(expected);
  });
});
