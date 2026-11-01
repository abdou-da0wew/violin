# Performance and tuning

Violin is designed to keep the application-facing `log()` path synchronous, predictable, and short. The transports own asynchronous I/O. This section explains the optimizations in the implementation; it does not claim a benchmark win over Pino or other mature loggers. Benchmark your own workload before choosing a logger for a latency-critical service.

## Hot-path behavior

1. **Level check first.** A disabled call returns before `mixin`, timestamp generation, field serialization, redaction, or transport iteration.
2. **No required runtime dependencies.** The core logger and console transport use built-in runtime APIs.
3. **No timestamp work when disabled.** Set `timestamp: false` to omit ISO string creation. The numeric `time` field remains available.
4. **Transport filtering.** The global logger threshold is checked once. Each transport may apply a narrower filter.
5. **Shared transports.** Child loggers share the root transports rather than allocating new queues, timers, or file descriptors.
6. **Buffered file writes.** The file transport has a bounded queue and serial writer; log calls do not call synchronous file APIs.
7. **Bounded network output.** Discord events enter a bounded queue and are sent serially with request timeouts and backoff.
8. **Lazy optional integrations.** Fastify types are imported as types; the root logger does not require Fastify at runtime.

## Configuration for throughput

```ts
const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG',
  timestamp: false,
  transports: [new ConsoleTransport({ format: 'json' })],
});
```

Avoid expensive object construction at the call site when a message may be disabled. JavaScript evaluates arguments before calling the logger:

```ts
if (logger.isEnabled('DEBUG')) {
  logger.debug('Expensive state snapshot', buildSnapshot());
}
```

Use `mixin` for small shared values only. It runs for each enabled log call. Keep custom serializers fast and deterministic.

## Queue sizing

- A larger file queue absorbs short bursts but consumes more memory if the disk is slow.
- `maxQueueSize` caps pending file lines; dropped entries are available through `getStats()`.
- `batchSize` balances write batching against event-loop time per drain.
- Discord queues should remain modest because webhooks have external rate limits.

Monitor queue depth and dropped counts in production. If dropped logs are unacceptable, prefer a dedicated collector or durable message queue.

## Benchmarking responsibly

Compare the same runtime, hardware, message shapes, destinations, log levels, and output formats. Measure both enabled and disabled calls; warm up the process; run multiple samples; report throughput and latency percentiles; and ensure the output sink is not the bottleneck. Do not compare a no-op logger against a logger doing JSON serialization and filesystem I/O.
