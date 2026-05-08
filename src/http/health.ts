import http from 'node:http';
import type Database from 'better-sqlite3';
import type { ResolvedConfig } from '../config/types.js';

export type HealthServerDeps = {
  config: ResolvedConfig;
  getUptimeSeconds: () => number;
  database: Database.Database;
  host: string;
  port: number;
  healthPath: string;
  webhookPath?: string;
  webhookHandler?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
};

export type HealthServer = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  server: http.Server;
};

function isDatabaseHealthy(db: Database.Database): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

export function createHealthServer(deps: HealthServerDeps): HealthServer {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === deps.healthPath) {
      const healthy = isDatabaseHealthy(deps.database);
      const body = JSON.stringify({
        status: healthy ? 'ok' : 'degraded',
        uptimeSeconds: deps.getUptimeSeconds(),
        telegramMode: deps.config.telegram.mode,
        llmProvider: deps.config.llm.provider,
        model: deps.config.llm.model,
        guardrailsEnabled: deps.config.guardrails.enabled,
        databaseStatus: healthy ? 'connected' : 'error',
      });
      res.writeHead(healthy ? 200 : 503, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    if (req.method === 'POST' && req.url === deps.webhookPath && deps.webhookHandler) {
      deps.webhookHandler(req, res);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(deps.port, deps.host, resolve);
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    server,
  };
}
