# Migrating from Pino

Violin provides a familiar structured logging API and an adapter for Fastify's `loggerInstance` option. It does not implement every Pino feature. Treat this guide as a supported migration surface, not a promise of complete API parity.

## Fastify setup

Before:

```ts
import Fastify from 'fastify';

const app = Fastify({ logger: true });
```

After:

```ts
import Fastify from 'fastify';
import { createLogger } from '@abdou-da0wew/violin';
import { createFastifyLogger } from '@abdou-da0wew/violin/fastify';

const logger = createLogger({ level: 'INFO' });
const app = Fastify({ loggerInstance: createFastifyLogger(logger) });
```

Use `loggerInstance`, not `logger`, when passing a custom logger object. Fastify documents these as distinct configuration paths.

## Common calls

| Pino-style call | Violin |
|---|---|
| `logger.info('ready')` | Supported |
| `logger.info({ port }, 'listening')` | Supported |
| `logger.error(error, 'failed')` | Supported |
| `logger.child({ requestId })` | Supported |
| `logger.level = 'debug'` | Supported, case-insensitive |
| `logger.isLevelEnabled('debug')` | Supported on Violin `Logger` |
| `logger.bindings()` | Supported on Violin `Logger` |
| `logger.flush()` | Supported as an asynchronous method |
| Custom Pino levels | Not supported as dynamic method creation |
| Pino hooks and serializers API | Not fully compatible; use Violin `serializers` and `mixin` options |
| Pino transport worker configuration | Use Violin's `Transport` interface |
| Pino extreme/asynchronous destination modes | Not implemented as Pino-compatible options |

## Structured fields and errors

Both object-first and message-first forms are accepted:

```ts
logger.info({ userId: 'u-1' }, 'User signed in');
logger.info('User signed in', { userId: 'u-1' });
logger.error(error, 'Database query failed');
```

Violin normalizes an Error instance passed as an argument. For predictable serialization, pass the Error itself rather than relying on arbitrary Pino-specific `err` serializers.

## Fastify request logging

Fastify may pass request and response objects to its logger. Violin's adapter converts `req` into a limited summary and `res` into a status code summary. Request headers and query strings are intentionally not copied. If your existing log pipeline depends on custom request serializers, implement an application hook that emits the exact safe fields you need.

## Thresholds

Violin levels are `TRACE`, `DEBUG`, `BUILD`, `INFO`, `SUCCESS`, `WARN`, `ERROR`, `CRITICAL`, and `FATAL`, plus `silent`. `SUCCESS` shares the `INFO` severity. `BUILD` and `CRITICAL` are additional levels compared with conventional Pino defaults.

## Before removing Pino

1. Search for Pino-specific methods, serializers, hooks, child options, custom levels, and transport configuration.
2. Replace Fastify's `logger` option with `loggerInstance: createFastifyLogger(...)`.
3. Convert custom output destinations to Violin transports.
4. Verify error serialization and request metadata in tests.
5. Run integration tests under the same Fastify major version as production.
6. Compare latency, throughput, and output volume with your real workload.

If a project depends on Pino features outside the documented adapter contract, keep Pino for that project or implement an explicit compatibility wrapper. Do not assume a method exists simply because both libraries have a method named `info()`.
