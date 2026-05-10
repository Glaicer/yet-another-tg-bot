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

export type ConsoleEvent = {
  level: 'error' | 'warn' | 'info';
  type: string;
  message: string;
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

  const insertConsoleEvent = db.prepare(
    `INSERT INTO console_events (timestamp, level, event_type, message, metadata)
     VALUES (?, ?, ?, ?, ?)`,
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

    logConsoleEvent(event: ConsoleEvent): void {
      const timestamp = new Date().toISOString();
      const message = redactValue(event.message, options.secrets, options.redactEnabled) ?? '';
      const metaStr = event.metadata
        ? redactValue(JSON.stringify(event.metadata), options.secrets, options.redactEnabled)
        : undefined;
      const metadata = metaStr ? (JSON.parse(metaStr) as Record<string, unknown>) : undefined;

      insertConsoleEvent.run(timestamp, event.level, event.type, message, metaStr ?? null);

      if (metadata) {
        console.log(`[${event.level}] ${event.type}: ${message}`, metadata);
      } else {
        console.log(`[${event.level}] ${event.type}: ${message}`);
      }
    },
  };
}
