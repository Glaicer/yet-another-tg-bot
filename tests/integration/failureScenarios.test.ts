import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_USER_ID,
  ALLOWED_CHAT_ID,
  BOT_USERNAME,
  REGULAR_USER_ID,
  makeGroupMessage,
  makePrivateMessage,
  setupApp,
} from '../helpers/integration.js';

describe('Failure scenarios', () => {
  it('sends error message on LLM timeout', async () => {
    const { app, captured, sendMessage, logBotEvent } = await setupApp({
      callLlm: vi.fn().mockRejectedValue(new Error('LLM request timed out after 60000ms')),
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: `@${BOT_USERNAME} hello`,
      }),
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sentText = sendMessage.mock.calls[0][0].text;
    expect(sentText).toContain('Sorry, I encountered an error');

    expect(logBotEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'llm_error',
        metadata: expect.objectContaining({
          error: 'LLM request timed out after 60000ms',
        }),
      }),
    );

    await app.stop();
  });

  it('handles guardrails provider timeout with fail-open', async () => {
    const mainLlm = vi.fn().mockResolvedValue({ text: 'Normal response' });
    const callLlm = vi.fn().mockImplementation((request: { url: string }) => {
      if (request.url.includes('guard')) {
        return Promise.reject(new Error('Guardrails timeout'));
      }
      return mainLlm(request);
    });

    const { app, captured, sendMessage, logGuardrailEvent } = await setupApp({
      callLlm,
      configOverrides: {
        guardrails: {
          enabled: true,
          failOpenOnProviderError: true,
          baseUrl: 'https://guard.example.com/v1',
          apiKey: 'guard-test',
          model: 'guard',
          timeoutMs: 8000,
          refusalMessage: "Can't help",
        } as never,
      },
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: `@${BOT_USERNAME} hello`,
      }),
    );

    // Should still call main LLM because failOpen is true
    expect(mainLlm).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    // Guardrail event should be logged
    expect(logGuardrailEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        blocked: false,
        reason: 'provider_error_fail_open',
      }),
    );

    await app.stop();
  });

  it('handles guardrails provider timeout with fail-closed', async () => {
    const mainLlm = vi.fn().mockResolvedValue({ text: 'Should not reach' });
    const callLlm = vi.fn().mockImplementation((request: { url: string }) => {
      if (request.url.includes('guard')) {
        return Promise.reject(new Error('Guardrails timeout'));
      }
      return mainLlm(request);
    });

    const { app, captured, sendMessage, logGuardrailEvent } = await setupApp({
      callLlm,
      configOverrides: {
        guardrails: {
          enabled: true,
          failOpenOnProviderError: false,
          baseUrl: 'https://guard.example.com/v1',
          apiKey: 'guard-test',
          model: 'guard',
          timeoutMs: 8000,
          refusalMessage: "Can't help",
        } as never,
      },
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: `@${BOT_USERNAME} hello`,
      }),
    );

    // Should NOT call main LLM because failOpen is false
    expect(mainLlm).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sentText = sendMessage.mock.calls[0][0].text;
    expect(sentText).toContain("Can't help");

    // Guardrail event should be logged
    expect(logGuardrailEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        blocked: true,
        reason: 'provider_error_fail_closed',
      }),
    );

    await app.stop();
  });

  it('does not store full user text in SQLite bot_events', async () => {
    const userText = 'my secret query about personal things';
    const repliedText = 'another secret message';
    const { app, mockDb, captured } = await setupApp({
      callLlm: vi.fn().mockResolvedValue({ text: 'Response' }),
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: `@${BOT_USERNAME} ${userText}`,
        replyToMessage: {
          message_id: 10,
          from: { id: 222, username: 'otheruser' },
          text: repliedText,
        },
      }),
    );

    // Query all bot_events
    const events = mockDb.prepare('SELECT * FROM bot_events').all() as Array<{
      event_type: string;
      metadata: string | null;
      details: string | null;
    }>;

    for (const event of events) {
      const eventJson = JSON.stringify(event);
      expect(eventJson).not.toContain(userText);
      expect(eventJson).not.toContain(repliedText);
    }

    await app.stop();
  });

  it('does not store full user text in SQLite guardrail_events', async () => {
    const userText = 'my secret guardrails query';
    const { app, mockDb, captured } = await setupApp({
      callLlm: vi.fn().mockResolvedValue({ text: 'Response' }),
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: `@${BOT_USERNAME} ${userText}`,
      }),
    );

    // Query all guardrail_events
    const events = mockDb.prepare('SELECT * FROM guardrail_events').all() as Array<{
      metadata: string | null;
      reason: string | null;
    }>;

    for (const event of events) {
      const eventJson = JSON.stringify(event);
      expect(eventJson).not.toContain(userText);
    }

    await app.stop();
  });

  it('redacts secrets in logged metadata', async () => {
    const { app, mockDb, captured, logBotEvent } = await setupApp({
      callLlm: vi.fn().mockRejectedValue(new Error('LLM request failed: 500')),
    });

    if (!captured.handleUpdate) throw new Error('handleUpdate not captured');
    await captured.handleUpdate(
      makeGroupMessage({
        text: `@${BOT_USERNAME} hello`,
      }),
    );

    // The error event should have been logged
    expect(logBotEvent).toHaveBeenCalled();

    // Query events and verify no secrets
    const events = mockDb.prepare('SELECT * FROM bot_events').all() as Array<{
      metadata: string | null;
      details: string | null;
    }>;

    for (const event of events) {
      const combined = `${event.metadata ?? ''} ${event.details ?? ''}`;
      expect(combined).not.toContain('sk-test');
      expect(combined).not.toContain('test-token');
    }

    await app.stop();
  });
});
