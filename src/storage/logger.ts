import type Database from 'better-sqlite3';
import { redactSecrets } from '../core/redact.js';

export type LoggerOptions = {
  secrets: string[];
  redactEnabled: boolean;
};

export type BotEvent = {
  type: string;
  chatId?: string;
  userId?: string;
  hash?: string;
  metadata?: Record<string, unknown>;
  details?: string;
};

export type GuardrailEvent = {
  chatId?: string;
  userId?: string;
  hash?: string;
  blocked: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
};

function redactValue(
  value: string | undefined,
  secrets: string[],
  enabled: boolean,
): string | undefined {
  if (!value || !enabled) return value;
  return redactSecrets(value, secrets);
}

export function createLogger(db: Database.Database, options: LoggerOptions) {
  const insertBotEvent = db.prepare(
    `INSERT INTO bot_events (event_type, timestamp, chat_id, user_id, hash, metadata, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertGuardrailEvent = db.prepare(
    `INSERT INTO guardrail_events (timestamp, chat_id, user_id, hash, blocked, reason, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    logBotEvent(event: BotEvent): void {
      const timestamp = new Date().toISOString();
      const metaStr = event.metadata
        ? redactValue(JSON.stringify(event.metadata), options.secrets, options.redactEnabled)
        : undefined;
      insertBotEvent.run(
        event.type,
        timestamp,
        event.chatId ?? null,
        event.userId ?? null,
        event.hash ?? null,
        metaStr ?? null,
        redactValue(event.details, options.secrets, options.redactEnabled) ?? null,
      );
    },

    logGuardrailEvent(event: GuardrailEvent): void {
      const timestamp = new Date().toISOString();
      const metaStr = event.metadata
        ? redactValue(JSON.stringify(event.metadata), options.secrets, options.redactEnabled)
        : undefined;
      insertGuardrailEvent.run(
        timestamp,
        event.chatId ?? null,
        event.userId ?? null,
        event.hash ?? null,
        event.blocked ? 1 : 0,
        event.reason ?? null,
        metaStr ?? null,
      );
    },
  };
}
