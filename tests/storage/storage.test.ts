import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashString } from '../../src/core/hash.js';
import { redactSecrets } from '../../src/core/redact.js';
import { createDatabase } from '../../src/storage/database.js';
import { createLogger } from '../../src/storage/logger.js';
import { getSetting, setSetting } from '../../src/storage/settings.js';

describe('storage', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
    dbPath = path.join(tempDir, 'test.sqlite');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('database', () => {
    it('creates schema on initialization', () => {
      const db = createDatabase(dbPath);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('bot_events');
      expect(names).toContain('guardrail_events');
      expect(names).toContain('bot_settings');
      db.close();
    });
  });

  describe('logger', () => {
    it('writes bot events without full user text', () => {
      const db = createDatabase(dbPath);
      const logger = createLogger(db, { secrets: [], redactEnabled: true });
      logger.logBotEvent({
        type: 'test_event',
        chatId: '-100123',
        userId: '456',
        hash: hashString('secret message'),
        metadata: { foo: 'bar' },
      });
      const rows = db.prepare('SELECT * FROM bot_events').all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].event_type).toBe('test_event');
      expect(rows[0].chat_id).toBe('-100123');
      expect(rows[0].user_id).toBe('456');
      expect(rows[0].hash).toBe(hashString('secret message'));
      expect(rows[0].details).toBeNull();
      const json = JSON.stringify(rows[0]);
      expect(json).not.toContain('secret message');
      db.close();
    });

    it('redacts secrets in bot event details', () => {
      const db = createDatabase(dbPath);
      const logger = createLogger(db, {
        secrets: ['super-secret-key'],
        redactEnabled: true,
      });
      logger.logBotEvent({
        type: 'llm_error',
        details: 'Error with super-secret-key in request',
      });
      const rows = db.prepare('SELECT * FROM bot_events').all() as Array<Record<string, unknown>>;
      expect(rows[0].details).toBe('Error with [REDACTED] in request');
      db.close();
    });

    it('writes guardrail audit events', () => {
      const db = createDatabase(dbPath);
      const logger = createLogger(db, { secrets: [], redactEnabled: true });
      logger.logGuardrailEvent({
        chatId: '-100123',
        userId: '456',
        hash: hashString('bad request'),
        blocked: true,
        reason: 'prompt_injection',
      });
      const rows = db.prepare('SELECT * FROM guardrail_events').all() as Array<
        Record<string, unknown>
      >;
      expect(rows).toHaveLength(1);
      expect(rows[0].blocked).toBe(1);
      expect(rows[0].reason).toBe('prompt_injection');
      expect(rows[0].hash).toBe(hashString('bad request'));
      db.close();
    });

    it('does not redact when redactEnabled is false', () => {
      const db = createDatabase(dbPath);
      const logger = createLogger(db, { secrets: ['secret'], redactEnabled: false });
      logger.logBotEvent({
        type: 'test',
        details: 'contains secret',
      });
      const rows = db.prepare('SELECT * FROM bot_events').all() as Array<Record<string, unknown>>;
      expect(rows[0].details).toBe('contains secret');
      db.close();
    });

    it('redacts metadata stringified values', () => {
      const db = createDatabase(dbPath);
      const logger = createLogger(db, {
        secrets: ['top-secret'],
        redactEnabled: true,
      });
      logger.logBotEvent({
        type: 'test',
        metadata: { msg: 'contains top-secret data' },
      });
      const rows = db.prepare('SELECT * FROM bot_events').all() as Array<Record<string, unknown>>;
      const metadata = JSON.parse(rows[0].metadata as string) as Record<string, unknown>;
      expect(metadata.msg).toBe('contains [REDACTED] data');
      db.close();
    });
  });

  describe('settings', () => {
    it('sets and gets a setting', () => {
      const db = createDatabase(dbPath);
      setSetting(db, 'selected_character', 'wizard');
      const value = getSetting(db, 'selected_character');
      expect(value).toBe('wizard');
      db.close();
    });

    it('returns undefined for missing setting', () => {
      const db = createDatabase(dbPath);
      const value = getSetting(db, 'missing_key');
      expect(value).toBeUndefined();
      db.close();
    });

    it('updates an existing setting', () => {
      const db = createDatabase(dbPath);
      setSetting(db, 'key1', 'value1');
      setSetting(db, 'key1', 'value2');
      const value = getSetting(db, 'key1');
      expect(value).toBe('value2');
      db.close();
    });
  });

  describe('redact', () => {
    it('redacts exact secrets', () => {
      const result = redactSecrets('key is abc123', ['abc123']);
      expect(result).toBe('key is [REDACTED]');
    });

    it('redacts bearer tokens', () => {
      const result = redactSecrets('Bearer eyJtoken123', []);
      expect(result).toBe('Bearer [REDACTED]');
    });

    it('redacts authorization headers', () => {
      const result = redactSecrets('Authorization: Bearer secret123', []);
      expect(result).toBe('Authorization: [REDACTED]');
    });

    it('redacts api key patterns', () => {
      const result = redactSecrets('api_key=secret123', []);
      expect(result).toBe('api_key=[REDACTED]');
    });

    it('redacts multiple secrets', () => {
      const result = redactSecrets('a=secret1 b=secret2', ['secret1', 'secret2']);
      expect(result).toBe('a=[REDACTED] b=[REDACTED]');
    });
  });

  describe('hash', () => {
    it('produces consistent hashes', () => {
      const h1 = hashString('hello');
      const h2 = hashString('hello');
      expect(h1).toBe(h2);
      expect(h1).not.toBe('hello');
      expect(h1).toHaveLength(64);
    });

    it('produces different hashes for different inputs', () => {
      const h1 = hashString('a');
      const h2 = hashString('b');
      expect(h1).not.toBe(h2);
    });
  });
});
