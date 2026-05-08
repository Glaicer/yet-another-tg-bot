function escapeSegment(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
}

export function escapeMarkdownV2(text: string): string {
  const result: string[] = [];
  let i = 0;

  while (i < text.length) {
    const backtickIndex = text.indexOf('`', i);

    if (backtickIndex === -1) {
      result.push(escapeSegment(text.slice(i)));
      break;
    }

    result.push(escapeSegment(text.slice(i, backtickIndex)));

    const closingIndex = text.indexOf('`', backtickIndex + 1);

    if (closingIndex === -1) {
      result.push('\\`');
      result.push(escapeSegment(text.slice(backtickIndex + 1)));
      break;
    }

    result.push('\\`');
    result.push(text.slice(backtickIndex + 1, closingIndex));
    result.push('\\`');

    i = closingIndex + 1;
  }

  return result.join('');
}
