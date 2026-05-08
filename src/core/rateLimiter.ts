export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

export type RateLimiter = {
  check(userId: string, chatId: string): RateLimitResult;
};

export function createRateLimiter(config: {
  enabled: boolean;
  perUser: { windowMs: number; maxRequests: number };
  perChat: { windowMs: number; maxRequests: number };
}): RateLimiter {
  if (!config.enabled) {
    return {
      check: () => ({ allowed: true }),
    };
  }

  const userWindows = new Map<string, number[]>();
  const chatWindows = new Map<string, number[]>();

  function pruneAndCount(
    timestamps: number[],
    windowMs: number,
  ): { count: number; oldest: number | null } {
    const now = Date.now();
    const cutoff = now - windowMs;
    let firstValid = timestamps.length;
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] > cutoff) {
        firstValid = i;
        break;
      }
    }
    const kept = timestamps.slice(firstValid);
    timestamps.length = 0;
    for (const ts of kept) {
      timestamps.push(ts);
    }
    return { count: timestamps.length, oldest: timestamps.length > 0 ? timestamps[0] : null };
  }

  return {
    check(userId: string, chatId: string): RateLimitResult {
      const now = Date.now();

      const userTimestamps = userWindows.get(userId) ?? [];
      userWindows.set(userId, userTimestamps);
      const userResult = pruneAndCount(userTimestamps, config.perUser.windowMs);

      const chatTimestamps = chatWindows.get(chatId) ?? [];
      chatWindows.set(chatId, chatTimestamps);
      const chatResult = pruneAndCount(chatTimestamps, config.perChat.windowMs);

      const userAllowed = userResult.count < config.perUser.maxRequests;
      const chatAllowed = chatResult.count < config.perChat.maxRequests;

      if (userAllowed && chatAllowed) {
        userTimestamps.push(now);
        chatTimestamps.push(now);
        return { allowed: true };
      }

      const retryAfterMs = Math.max(
        userResult.oldest !== null ? config.perUser.windowMs - (now - userResult.oldest) : 0,
        chatResult.oldest !== null ? config.perChat.windowMs - (now - chatResult.oldest) : 0,
      );

      return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
    },
  };
}
