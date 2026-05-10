import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  chat_id TEXT,
  user_id TEXT,
  hash TEXT,
  metadata TEXT,
  details TEXT
);

CREATE TABLE IF NOT EXISTS guardrail_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  chat_id TEXT,
  user_id TEXT,
  hash TEXT,
  blocked INTEGER NOT NULL,
  reason TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS console_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT
);
`;

export function createDatabase(databasePath: string): Database.Database {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
