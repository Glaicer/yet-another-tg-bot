import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../../src/config/types.js';
import { createHealthServer } from '../../src/http/health.js';

function createMockDb(healthy = true) {
  return {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation(() => {
        if (!healthy) throw new Error('DB error');
        return { '1': 1 };
      }),
    }),
  } as unknown as import('better-sqlite3').Database;
}

function createConfig(): ResolvedConfig {
  return {
    telegram: {
      mode: 'polling',
      allowedChatId: '-100123',
      adminUserId: '12345',
      typingIndicator: { enabled: true, intervalMs: 4500 },
      webhook: { publicUrl: null, path: '/webhook' },
    },
    llm: {
      provider: 'openai',
      model: 'gpt-4',
      apiMode: 'responses',
      apiKey: 'sk-secret-key',
      baseUrl: 'https://api.openai.com/v1',
      temperature: 0.7,
      maxTokens: 800,
      reasoningEffort: 'none',
      supportsWebSearch: true,
      webSearch: { mode: 'openai_tool', maxResults: 5, requireCitations: true },
    },
    guardrails: {
      enabled: true,
      failOpenOnProviderError: true,
      provider: 'openai',
      apiKey: 'guard-secret',
      baseUrl: 'https://guard.example.com/v1',
      model: 'guard-model',
      timeoutMs: 8000,
      refusalMessage: "Can't help",
      checkInput: true,
      checkOutput: false,
      blockPromptInjection: true,
    },
    storage: { type: 'sqlite', databasePath: '/app/data/bot.db' },
  } as ResolvedConfig;
}

function makeRequest(
  server: http.Server,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> | string }> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Server not listening'));
      return;
    }
    const req = http.get(`http://127.0.0.1:${address.port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const body = data ? JSON.parse(data) : '';
          resolve({ status: res.statusCode ?? 0, body });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data });
        }
      });
    });
    req.on('error', reject);
  });
}

describe('createHealthServer', () => {
  it('returns 200 with required safe fields on health endpoint', async () => {
    const config = createConfig();
    const server = createHealthServer({
      config,
      getUptimeSeconds: () => 42,
      database: createMockDb(true),
      host: '127.0.0.1',
      port: 0,
      healthPath: '/healthz',
    });
    await server.start();
    const { status, body } = await makeRequest(server.server, '/healthz');
    await server.stop();

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.uptimeSeconds).toBe(42);
    expect(body.telegramMode).toBe('polling');
    expect(body.llmProvider).toBe('openai');
    expect(body.model).toBe('gpt-4');
    expect(body.guardrailsEnabled).toBe(true);
    expect(body.databaseStatus).toBe('connected');
  });

  it('does not contain secrets in health response', async () => {
    const config = createConfig();
    const server = createHealthServer({
      config,
      getUptimeSeconds: () => 42,
      database: createMockDb(true),
      host: '127.0.0.1',
      port: 0,
      healthPath: '/healthz',
    });
    await server.start();
    const { body } = await makeRequest(server.server, '/healthz');
    await server.stop();

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('sk-secret-key');
    expect(bodyStr).not.toContain('guard-secret');
    expect(bodyStr).not.toContain('/app/data/bot.db');
  });

  it('returns 503 when database is unhealthy', async () => {
    const config = createConfig();
    const server = createHealthServer({
      config,
      getUptimeSeconds: () => 42,
      database: createMockDb(false),
      host: '127.0.0.1',
      port: 0,
      healthPath: '/healthz',
    });
    await server.start();
    const { status, body } = await makeRequest(server.server, '/healthz');
    await server.stop();

    expect(status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.databaseStatus).toBe('error');
  });

  it('returns 404 for unknown paths', async () => {
    const config = createConfig();
    const server = createHealthServer({
      config,
      getUptimeSeconds: () => 42,
      database: createMockDb(true),
      host: '127.0.0.1',
      port: 0,
      healthPath: '/healthz',
    });
    await server.start();
    const { status } = await makeRequest(server.server, '/unknown');
    await server.stop();

    expect(status).toBe(404);
  });

  it('delegates POST to webhookHandler when configured', async () => {
    const webhookHandler = vi.fn().mockImplementation((_req, res) => {
      res.writeHead(200);
      res.end('OK');
    });
    const config = createConfig();
    const server = createHealthServer({
      config,
      getUptimeSeconds: () => 42,
      database: createMockDb(true),
      host: '127.0.0.1',
      port: 0,
      healthPath: '/healthz',
      webhookPath: '/webhook',
      webhookHandler,
    });
    await server.start();

    const address = server.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server not listening');
    }

    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/webhook',
          method: 'POST',
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: data });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });

    await server.stop();
    expect(response.status).toBe(200);
    expect(response.body).toBe('OK');
    expect(webhookHandler).toHaveBeenCalledTimes(1);
  });
});
