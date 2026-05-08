export function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      result = result.replaceAll(secret, '[REDACTED]');
    }
  }
  result = result.replace(/Bearer\s+[a-zA-Z0-9\-_.]+/g, 'Bearer [REDACTED]');
  result = result.replace(/Authorization:\s*.+/gi, 'Authorization: [REDACTED]');
  result = result.replace(/api[_-]?key\s*[=:]\s*[a-zA-Z0-9\-_.]+/gi, 'api_key=[REDACTED]');
  return result;
}
