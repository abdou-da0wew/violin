# Transports

A transport receives a normalized `LogEntry`. Its `log(entry)` method must be synchronous and non-blocking. Queue network or disk work internally. Violin catches synchronous transport errors so a logging sink cannot crash the application request that emitted the log.

## ConsoleTransport

```ts
new ConsoleTransport({
  level: 'DEBUG',
  format: 'auto', // auto | pretty | json
  colors: 'auto', // auto | true | false
  appName: 'worker',
});
```

`auto` uses pretty output for a TTY and JSON otherwise. Errors and more severe events are written to stderr; lower levels go to stdout. Custom streams can be provided for tests or embedded runtimes.

## FileTransport

```ts
new FileTransport({
  directory: './logs',
  level: 'INFO',
  maxSize: 20 * 1024 * 1024,
  maxFiles: 5,
  maxQueueSize: 10_000,
  batchSize: 256,
  flushIntervalMs: 250,
});
```

Writes newline-delimited JSON to daily files named `log_YYYY-MM-DD.jsonl`. Writes are batched and serialized through one queue drain, including rotation. The queue is bounded; when full, new entries are dropped and counted instead of allowing unbounded memory growth. Use `getStats()` to inspect `queued`, `dropped`, `bytesWritten`, and `lastError`.

`flush()` waits for queued data to be passed to the file stream. `close()` flushes and closes the stream and timer. Filesystem errors are retained in `lastError`; they do not throw from the original application logging call.

The transport is designed for one process writing a given log directory. For multi-process deployments, prefer one log directory per process or stdout collection. Shared-file rotation across independent processes is not coordinated.

## DiscordTransport

```ts
new DiscordTransport({
  webhookUrl: process.env.LOG_DISCORD_WEBHOOK!,
  levels: ['ERROR', 'CRITICAL', 'FATAL'],
  maxQueueSize: 100,
  flushIntervalMs: 1000,
  requestTimeoutMs: 5000,
  baseBackoffMs: 1000,
  maxBackoffMs: 30_000,
});
```

The default accepted levels are `ERROR`, `CRITICAL`, and `FATAL`. Requests are serialized, queue size is bounded, mentions are disabled in payloads, Discord rate-limit delays are observed, and retries use capped exponential backoff. A permanent client error is discarded. `getStats()` returns the pending queue size, dropped count, and remaining backoff time.

Network delivery is best effort. During prolonged outages, entries can be dropped when the queue reaches its configured maximum. On `close()`, one final delivery attempt is made and any entries still pending are counted as dropped, so shutdown does not hang on an unavailable webhook. Do not treat a webhook as your only durable audit log.

## Write a custom transport

```ts
import type { LogEntry, LogLevel, Transport } from '@abdou-da0wew/violin';

export class MetricsTransport implements Transport {
  readonly name = 'metrics';

  supports(level: LogLevel): boolean {
    return level === 'ERROR' || level === 'FATAL';
  }

  log(entry: LogEntry): void {
    // Keep this method cheap. Queue external I/O rather than awaiting it here.
    incrementCounter('application_log_events', {
      level: entry.level,
      service: String(entry.bindings?.service ?? 'unknown'),
    });
  }

  async flush(): Promise<void> {
    await flushMetrics();
  }

  async close(): Promise<void> {
    await closeMetrics();
  }
}
```

`supports()` is optional. `flush()` and `close()` may return promises. Violin calls them during explicit lifecycle operations and waits with `Promise.allSettled`, so one broken transport does not prevent other transports from closing.
