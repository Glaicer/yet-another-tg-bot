export type QueueResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'queue-full' | 'timeout' | 'error' };

export type RequestQueue = {
  enqueue<T>(task: () => Promise<T>): Promise<QueueResult<T>>;
};

type QueueItem<T> = {
  task: () => Promise<T>;
  resolve: (result: QueueResult<T>) => void;
  waitingTimer: ReturnType<typeof setTimeout> | null;
  runningTimer: ReturnType<typeof setTimeout> | null;
  done: boolean;
};

export function createRequestQueue(config: {
  enabled: boolean;
  maxConcurrentRequests: number;
  maxQueueSize: number;
  timeoutMs: number;
}): RequestQueue {
  if (!config.enabled) {
    return {
      async enqueue<T>(task: () => Promise<T>): Promise<QueueResult<T>> {
        try {
          const value = await task();
          return { ok: true, value };
        } catch {
          return { ok: false, reason: 'error' };
        }
      },
    };
  }

  let runningCount = 0;
  const waiting: Array<QueueItem<unknown>> = [];

  function processQueue(): void {
    while (runningCount < config.maxConcurrentRequests && waiting.length > 0) {
      const item = waiting.shift();
      if (!item) break;

      if (item.waitingTimer) {
        clearTimeout(item.waitingTimer);
        item.waitingTimer = null;
      }

      if (item.done) {
        continue;
      }

      runItem(item);
    }
  }

  function runItem<T>(item: QueueItem<T>): void {
    runningCount++;

    item.runningTimer = setTimeout(() => {
      if (item.done) return;
      item.done = true;
      runningCount--;
      item.resolve({ ok: false, reason: 'timeout' });
      processQueue();
    }, config.timeoutMs);

    const finish = (result: QueueResult<T>) => {
      if (item.done) return;
      item.done = true;
      if (item.runningTimer) {
        clearTimeout(item.runningTimer);
        item.runningTimer = null;
      }
      runningCount--;
      item.resolve(result);
      processQueue();
    };

    item
      .task()
      .then((value) => finish({ ok: true, value }))
      .catch(() => finish({ ok: false, reason: 'error' }));
  }

  return {
    enqueue<T>(task: () => Promise<T>): Promise<QueueResult<T>> {
      return new Promise<QueueResult<T>>((resolve) => {
        const item: QueueItem<T> = {
          task,
          resolve: resolve as (result: QueueResult<unknown>) => void,
          waitingTimer: null,
          runningTimer: null,
          done: false,
        };

        if (runningCount < config.maxConcurrentRequests) {
          runItem(item);
          return;
        }

        if (waiting.length >= config.maxQueueSize) {
          resolve({ ok: false, reason: 'queue-full' });
          return;
        }

        item.waitingTimer = setTimeout(() => {
          if (item.done) return;
          item.done = true;
          const index = waiting.indexOf(item as unknown as QueueItem<unknown>);
          if (index >= 0) {
            waiting.splice(index, 1);
          }
          item.resolve({ ok: false, reason: 'timeout' });
        }, config.timeoutMs);

        waiting.push(item as unknown as QueueItem<unknown>);
      });
    },
  };
}
