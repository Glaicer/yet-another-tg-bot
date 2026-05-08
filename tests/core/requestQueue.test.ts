import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../../src/config/types.js';
import { createRequestQueue } from '../../src/core/requestQueue.js';

function makeConfig(overrides?: Partial<ResolvedConfig['queue']>): ResolvedConfig['queue'] {
  return {
    enabled: true,
    maxConcurrentRequests: 2,
    maxQueueSize: 3,
    timeoutMs: 5000,
    ...overrides,
  };
}

describe('requestQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs task immediately when disabled', async () => {
    const queue = createRequestQueue(makeConfig({ enabled: false }));
    const result = await queue.enqueue(async () => 'ok');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('ok');
    }
  });

  it('runs tasks immediately when under concurrency limit', async () => {
    const queue = createRequestQueue(makeConfig({ maxConcurrentRequests: 2 }));
    const p1 = queue.enqueue(async () => 'a');
    const p2 = queue.enqueue(async () => 'b');
    const r1 = await p1;
    const r2 = await p2;
    expect(r1.ok && r1.value).toBe('a');
    expect(r2.ok && r2.value).toBe('b');
  });

  it('queues tasks when concurrency is saturated', async () => {
    const queue = createRequestQueue(makeConfig({ maxConcurrentRequests: 1, maxQueueSize: 2 }));
    let running = 0;
    let maxRunning = 0;

    const task = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      running--;
      return 'done';
    };

    const p1 = queue.enqueue(task);
    const p2 = queue.enqueue(task);
    const p3 = queue.enqueue(task);

    await vi.advanceTimersByTimeAsync(50);
    expect(maxRunning).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    await p1;
    await vi.advanceTimersByTimeAsync(100);
    await p2;
    await vi.advanceTimersByTimeAsync(100);
    await p3;

    expect(maxRunning).toBe(1);
    expect(running).toBe(0);
  });

  it('rejects when queue is full', async () => {
    const queue = createRequestQueue(
      makeConfig({ maxConcurrentRequests: 1, maxQueueSize: 1, timeoutMs: 10000 }),
    );
    const p1 = queue.enqueue(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
      return 'blocker';
    });
    const p2 = queue.enqueue(async () => 'queued');
    const p3 = queue.enqueue(async () => 'rejected');

    const r3 = await p3;
    expect(r3.ok).toBe(false);
    if (!r3.ok) {
      expect(r3.reason).toBe('queue-full');
    }

    // clean up
    await vi.advanceTimersByTimeAsync(5000);
    await p1;
    await p2;
  });

  it('times out waiting items', async () => {
    const queue = createRequestQueue(
      makeConfig({ maxConcurrentRequests: 1, maxQueueSize: 3, timeoutMs: 1000 }),
    );
    // Two sequential long tasks keep the slot busy so p3 waits > timeoutMs
    const p1 = queue.enqueue(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      return 'a';
    });
    const p2 = queue.enqueue(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      return 'b';
    });
    const p3 = queue.enqueue(async () => 'c');

    await vi.advanceTimersByTimeAsync(1500);
    const r3 = await p3;
    expect(r3.ok).toBe(false);
    if (!r3.ok) {
      expect(r3.reason).toBe('timeout');
    }

    await vi.advanceTimersByTimeAsync(1000);
    const r1 = await p1;
    const r2 = await p2;
    expect(r1.ok && r1.value).toBe('a');
    expect(r2.ok && r2.value).toBe('b');
  });

  it('times out running items', async () => {
    const queue = createRequestQueue(
      makeConfig({ maxConcurrentRequests: 1, maxQueueSize: 1, timeoutMs: 1000 }),
    );
    const p1 = queue.enqueue(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
      return 'a';
    });

    await vi.advanceTimersByTimeAsync(1500);
    const r1 = await p1;
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.reason).toBe('timeout');
    }
  });

  it('releases concurrency slot after task error', async () => {
    const queue = createRequestQueue(
      makeConfig({ maxConcurrentRequests: 1, maxQueueSize: 2, timeoutMs: 10000 }),
    );
    const p1 = queue.enqueue(async () => {
      throw new Error('boom');
    });

    const r1 = await p1;
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.reason).toBe('error');
    }

    // p2 should run immediately since slot was freed
    const p2 = queue.enqueue(async () => 'ok');
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value).toBe('ok');
    }
  });

  it('releases concurrency slot after task success', async () => {
    const queue = createRequestQueue(
      makeConfig({ maxConcurrentRequests: 1, maxQueueSize: 2, timeoutMs: 10000 }),
    );
    const p1 = queue.enqueue(async () => 'done');
    const r1 = await p1;
    expect(r1.ok).toBe(true);

    const p2 = queue.enqueue(async () => 'ok');
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value).toBe('ok');
    }
  });

  it('cleans up timeout timers after task completes normally', async () => {
    const queue = createRequestQueue(
      makeConfig({ maxConcurrentRequests: 1, maxQueueSize: 1, timeoutMs: 10000 }),
    );
    const p1 = queue.enqueue(async () => 'done');
    await p1;
    // No timers should be left pending
    expect(vi.getTimerCount()).toBe(0);
  });
});
