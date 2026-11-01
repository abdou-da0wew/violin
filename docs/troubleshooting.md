# Troubleshooting

## Nothing is printed

- Check the logger threshold. `INFO` hides `DEBUG`, `BUILD`, and `TRACE` events.
- Check transport-specific thresholds. A transport can filter more aggressively than the logger.
- If you pass `transports`, remember that the list replaces the default console transport.
- Verify that the logger has not been closed.

```ts
console.log('level:', logger.getLevel());
console.log('debug enabled:', logger.isEnabled('DEBUG'));
```

## File logs are missing

- Confirm the process can create and write to the configured directory.
- Call `await logger.flush()` before reading files during a running process.
- Inspect `fileTransport.getStats()` for queued entries, dropped entries, and `lastError`.
- Keep one process per file output directory. Violin does not coordinate file rotation across independent processes.

## Logs are dropped during bursts

File and Discord queues are bounded by design. Increase `maxQueueSize` to absorb larger short-lived bursts, then monitor memory and drop counters. If the destination is consistently slower than the application, use a dedicated collector or durable queue instead of increasing the in-process queue indefinitely.

## Discord webhook does not deliver

- Confirm the webhook URL is valid and loaded from a secret manager or environment variable.
- Discord transport accepts `ERROR`, `CRITICAL`, and `FATAL` by default. Configure `levels` to include other severities.
- Check for permanent 4xx responses, invalid webhook configuration, timeout, or rate limiting.
- Inspect `getStats()` and remember that Discord delivery is best effort.

## Fastify rejects loggerInstance

- Use `loggerInstance: createFastifyLogger(logger)`, not `logger: loggerInstance`.
- Import the adapter from `@abdou-da0wew/violin/fastify`.
- Install Fastify in the application; it is an optional peer dependency.
- Use a Fastify major version supported by the installed Violin release (v4 or v5 in this release).

## TypeScript cannot find a subpath

Make sure the installed package version includes the corresponding export and that the project uses a modern Node-compatible module resolver such as `NodeNext` or `Bundler`. The root, `./fastify`, `./errors`, and `./transports` subpaths are exported.

## Secrets still appear in logs

Redaction is a safety net, not a guarantee. Add the exact key paths to `redact.paths`, avoid logging sensitive objects, and write serializers that select only safe properties. Review messages and nested fields separately. See [Security](security.md).
