# Getting started

## Install

```sh
bun add @abdou-da0wew/violin
# pnpm add @abdou-da0wew/violin
# npm install @abdou-da0wew/violin
```

Violin requires no runtime dependencies. Add Fastify to your application separately when using the adapter.

## Create your logger

```ts
import { createLogger } from '@abdou-da0wew/violin';

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'INFO',
  base: { service: 'my-service', environment: process.env.NODE_ENV ?? 'development' },
});
```

Use one root logger per application process. Pass it into modules or create child loggers that bind module-specific context.

## Write useful events

```ts
logger.info('User signed in', { userId: 'user_123', method: 'passkey' });
logger.warn('Queue nearing capacity', { queue: 'emails', depth: 920, capacity: 1000 });
logger.error(new Error('Connection reset'), 'Payment provider request failed', { provider: 'example' });
```

Use stable field names and numeric durations. Avoid putting identifiers and state only in prose.

## Shutdown

Call `flush()` when you need to wait for queued output without closing transports. Call `close()` once during application shutdown to flush and release resources. `close()` is idempotent.

```ts
const shutdown = async () => {
  await logger.close();
};

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
```

Do not create one file or Discord transport per request. Transports own timers, queues, and file handles and should live for the process lifetime.
