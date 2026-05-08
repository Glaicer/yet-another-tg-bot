import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../../src/config/types.js';
import { createRateLimiter } from '../../src/core/rateLimiter.js';

function makeConfig(overrides?: Partial<ResolvedConfig['rateLimit']>): ResolvedConfig['rateLimit'] {
  return {
    enabled: true,
    perUser: { windowMs: 60000, maxRequests: 3 },
    perChat: { windowMs: 60000, maxRequests: 5 },
    ...overrides,
  };
}

describe('rateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows all requests when disabled', () => {
    const limiter = createRateLimiter(makeConfig({ enabled: false }));
    for (let i = 0; i < 100; i++) {
      const result = limiter.check('user1', 'chat1');
      expect(result.allowed).toBe(true);
    }
  });

  it('allows requests up to per-user limit', () => {
    const limiter = createRateLimiter(makeConfig({ perUser: { windowMs: 10000, maxRequests: 2 } }));
    expect(limiter.check('user1', 'chat1').allowed).toBe(true);
    expect(limiter.check('user1', 'chat1').allowed).toBe(true);
    const blocked = limiter.check('user1', 'chat1');
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('allows requests up to per-chat limit', () => {
    const limiter = createRateLimiter(makeConfig({ perChat: { windowMs: 10000, maxRequests: 2 } }));
    expect(limiter.check('user1', 'chat1').allowed).toBe(true);
    expect(limiter.check('user2', 'chat1').allowed).toBe(true);
    const blocked = limiter.check('user3', 'chat1');
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('resets per-user window after windowMs', () => {
    const limiter = createRateLimiter(makeConfig({ perUser: { windowMs: 5000, maxRequests: 1 } }));
    expect(limiter.check('user1', 'chat1').allowed).toBe(true);
    expect(limiter.check('user1', 'chat1').allowed).toBe(false);
    vi.advanceTimersByTime(5001);
    expect(limiter.check('user1', 'chat1').allowed).toBe(true);
  });

  it('resets per-chat window after windowMs', () => {
    const limiter = createRateLimiter(makeConfig({ perChat: { windowMs: 5000, maxRequests: 1 } }));
    expect(limiter.check('user1', 'chat1').allowed).toBe(true);
    expect(limiter.check('user2', 'chat1').allowed).toBe(false);
    vi.advanceTimersByTime(5001);
    expect(limiter.check('user2', 'chat1').allowed).toBe(true);
  });

  it('tracks different users independently', () => {
    const limiter = createRateLimiter(makeConfig({ perUser: { windowMs: 10000, maxRequests: 1 } }));
    expect(limiter.check('userA', 'chat1').allowed).toBe(true);
    expect(limiter.check('userB', 'chat1').allowed).toBe(true);
    expect(limiter.check('userA', 'chat1').allowed).toBe(false);
    expect(limiter.check('userB', 'chat1').allowed).toBe(false);
  });

  it('tracks different chats independently', () => {
    const limiter = createRateLimiter(makeConfig({ perChat: { windowMs: 10000, maxRequests: 1 } }));
    expect(limiter.check('user1', 'chatA').allowed).toBe(true);
    expect(limiter.check('user1', 'chatB').allowed).toBe(true);
    expect(limiter.check('user1', 'chatA').allowed).toBe(false);
    expect(limiter.check('user1', 'chatB').allowed).toBe(false);
  });

  it('returns retryAfterMs based on oldest request in window', () => {
    const limiter = createRateLimiter(
      makeConfig({
        perUser: { windowMs: 10000, maxRequests: 2 },
        perChat: { windowMs: 10000, maxRequests: 100 },
      }),
    );
    expect(limiter.check('user1', 'chat1').allowed).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(limiter.check('user1', 'chat1').allowed).toBe(true);
    vi.advanceTimersByTime(1000);
    const blocked = limiter.check('user1', 'chat1');
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      // oldest request was at t=0, window is 10000, so retry after ~6000ms
      expect(blocked.retryAfterMs).toBeGreaterThanOrEqual(5000);
      expect(blocked.retryAfterMs).toBeLessThanOrEqual(7000);
    }
  });

  it('both per-user and per-chat must allow', () => {
    const limiter = createRateLimiter(
      makeConfig({
        perUser: { windowMs: 10000, maxRequests: 1 },
        perChat: { windowMs: 10000, maxRequests: 100 },
      }),
    );
    expect(limiter.check('user1', 'chat1').allowed).toBe(true);
    expect(limiter.check('user1', 'chat1').allowed).toBe(false);

    const limiter2 = createRateLimiter(
      makeConfig({
        perUser: { windowMs: 10000, maxRequests: 100 },
        perChat: { windowMs: 10000, maxRequests: 1 },
      }),
    );
    expect(limiter2.check('user1', 'chat1').allowed).toBe(true);
    expect(limiter2.check('user2', 'chat1').allowed).toBe(false);
  });
});
