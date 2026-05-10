const markdownV2SpecialChars = '_*[]()~`>#+-=|{}.!';

function escapeFormattedSegment(text: string): string {
  let result = '';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '\\' && nextChar && markdownV2SpecialChars.includes(nextChar)) {
      result += char + nextChar;
      i += 1;
    } else if (char === '\\') {
      result += '\\\\';
    } else if (markdownV2SpecialChars.includes(char)) {
      result += `\\${char}`;
    } else {
      result += char;
    }
  }

  return result;
}

function escapeCodeSegment(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

function escapeLinkUrl(url: string): string {
  return url.replace(/\\/g, '\\\\').replace(/\)/g, '\\)');
}

export function formatTelegramMarkdownV2(text: string): string {
  const result: string[] = [];
  let plainStart = 0;
  let i = 0;

  const flushPlain = (end: number) => {
    if (end > plainStart) {
      result.push(escapeFormattedSegment(text.slice(plainStart, end)));
    }
  };

  while (i < text.length) {
    if (text[i] === '`') {
      const closingIndex = text.indexOf('`', i + 1);
      if (closingIndex !== -1) {
        flushPlain(i);
        result.push('`');
        result.push(escapeCodeSegment(text.slice(i + 1, closingIndex)));
        result.push('`');
        i = closingIndex + 1;
        plainStart = i;
        continue;
      }
    }

    if (text.startsWith('**', i)) {
      const closingIndex = text.indexOf('**', i + 2);
      if (closingIndex !== -1 && closingIndex > i + 2) {
        flushPlain(i);
        result.push('*');
        result.push(escapeFormattedSegment(text.slice(i + 2, closingIndex)));
        result.push('*');
        i = closingIndex + 2;
        plainStart = i;
        continue;
      }
    }

    if (text[i] === '[') {
      const labelEnd = text.indexOf(']', i + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const urlEnd = text.indexOf(')', labelEnd + 2);
        if (urlEnd !== -1 && urlEnd > labelEnd + 2) {
          flushPlain(i);
          result.push('[');
          result.push(escapeFormattedSegment(text.slice(i + 1, labelEnd)));
          result.push('](');
          result.push(escapeLinkUrl(text.slice(labelEnd + 2, urlEnd)));
          result.push(')');
          i = urlEnd + 1;
          plainStart = i;
          continue;
        }
      }
    }

    i += 1;
  }

  flushPlain(text.length);
  return result.join('');
}
