<div align="center">

# Violin

### Structured logging for applications that need more than `console.log`.

[![npm version](https://img.shields.io/npm/v/@abdou-da0wew/violin?style=flat-square&label=npm)](https://www.npmjs.com/package/@abdou-da0wew/violin)
[![npm downloads](https://img.shields.io/npm/dm/@abdou-da0wew/violin?style=flat-square)](https://www.npmjs.com/package/@abdou-da0wew/violin)
[![CI](https://img.shields.io/github/actions/workflow/status/abdou-da0wew/violin/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/abdou-da0wew/violin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/Bun-supported-f9f1e1?style=flat-square&logo=bun&logoColor=000)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**A fast, extensible logger for Node.js and Bun.** Structured events, configurable transports, built-in redaction, application errors, and a Fastify adapter designed to replace Fastify's default Pino logger instance.

[Getting Started](docs/getting-started.md) · [Documentation](#documentation) · [Fastify](docs/fastify.md) · [API Reference](docs/api.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## What is Violin?

Violin is a TypeScript-first logging toolkit built around one small idea: application code should emit useful structured events without knowing where those events end up.

The logger handles filtering, context, serialization, and redaction. Transports handle output. That separation keeps the API consistent across a CLI, worker, API server, Discord bot, or any other Node.js/Bun application.

Violin started from the error and logger utilities used in Triecbot. Those utilities have been extracted, redesigned, and generalized into an independent package. The original Triecbot source remains separate.

## Features

| Area | What you get |
|---|---|
| Structured logging | Consistent entries with severity, timestamps, bindings, fields, and normalized errors |
| Familiar API | Message-first and Pino-style object-first calls, plus child loggers |
| Fastify | `loggerInstance` adapter for Fastify 4 and 5, without a Pino runtime dependency |
| Transports | Console, batched JSONL files, Discord webhooks, and a public custom transport interface |
| Redaction | Secret-key detection, text redaction, configurable paths, serializers, and circular-value handling |
| Application errors | Stable error codes, HTTP status codes, causes, context, and safe response serialization |
| Runtime support | Node.js 20+ and Bun; ESM and CommonJS builds |
| Lifecycle | Explicit `flush()`, `close()`, and `destroy()` methods |

## Installation

```bash
# Bun
bun add @abdou-da0wew/violin

# pnpm
pnpm add @abdou-da0wew/violin

# npm
npm install @abdou-da0wew/violin
```

Violin has **no required runtime dependencies**. Fastify is an optional peer dependency and is only needed when using the Fastify adapter.

> **Release status:** the repository's source, tests, build, and package tarball are maintained here. The npm release is published separately from GitHub releases.

## Quick start

```ts
import { createLogger } from '@abdou-da0wew/violin';

const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'INFO',
  base: {
    service: 'billing-api',
    environment: process.env.NODE_ENV ?? 'development',
  },
});

logger.info('Application started', { port: 3000 });
logger.warn({ retryInMs: 1000 }, 'Payment provider is responding slowly');

try {
  await chargeCustomer();
} catch (error) {
  logger.error(error instanceof Error ? error : new Error(String(error)), 'Payment failed');
}

// During graceful shutdown:
await logger.flush();
await logger.close();
```

When stdout is a TTY, the default console transport uses readable output. In non-interactive environments it emits JSON lines, which work naturally with container log collectors.

## Pino-style logging

Violin accepts both common call styles:

```ts
// Message first
logger.info('User signed in', { userId: 'user_123', method: 'passkey' });

// Structured object first, like Pino
logger.info({ userId: 'user_123', method: 'passkey' }, 'User signed in');

// Errors
logger.error(error, 'Database operation failed');
logger.error('Database operation failed', error, { operation: 'query' });

// Context that follows an operation across multiple log calls
const requestLogger = logger.child({ requestId: 'req_abc', userId: 'user_123' });
requestLogger.info('Request accepted');
requestLogger.info('Request completed', { statusCode: 200, durationMs: 18 });
```

Fields belong in structured data; the message should explain the event. A child logger shares its parent's transports and configuration while keeping its own bindings.

## Fastify integration

Use Violin as Fastify's logger instance:

```ts
import Fastify from 'fastify';
import { createLogger } from '@abdou-da0wew/violin';
import { createFastifyLogger } from '@abdou-da0wew/violin/fastify';

const violin = createLogger({
  level: 'INFO',
  base: { service: 'catalog-api' },
});

const app = Fastify({
  loggerInstance: createFastifyLogger(violin),
});

app.get('/health', async () => ({ ok: true }));

await app.listen({ host: '0.0.0.0', port: 3000 });
```

The adapter implements Fastify's base logger contract, including `child()` and a mutable `level`. It also summarizes Fastify request/response objects instead of logging request headers and internal objects wholesale. Fastify remains an optional peer dependency.

**Compatibility note:** this adapter targets Fastify's `loggerInstance` interface. It is not a claim of complete drop-in compatibility with every Pino extension, transport, hook, or custom level API. See [Fastify integration and migration](docs/fastify.md) and [Pino migration notes](docs/migration-from-pino.md).

## Configure transports

Choose where events go without changing application logging calls:

```ts
import {
  createLogger,
  ConsoleTransport,
  FileTransport,
} from '@abdou-da0wew/violin';

const logger = createLogger({
  level: 'DEBUG',
  base: { service: 'worker', version: '1.4.0' },
  transports: [
    new ConsoleTransport({ format: 'auto', colors: 'auto' }),
    new FileTransport({
      directory: './logs',
      level: 'INFO',
      maxSize: 20 * 1024 * 1024,
      maxFiles: 5,
      maxQueueSize: 10_000,
    }),
  ],
});
```

Available transports:

- **Console:** pretty output for terminals and JSON for log collectors; supports custom streams.
- **File:** daily JSONL files, bounded queue, batched writes, and size-based rotation.
- **Discord:** bounded, sequential webhook delivery with timeouts and rate-limit backoff. Disabled unless explicitly configured.
- **Custom:** implement the small `Transport` interface to integrate any destination.

When you provide a `transports` array, it replaces the default console transport. Add `ConsoleTransport` explicitly when you want both console and other outputs.

## Application errors

```ts
import { AppError, ErrorCode } from '@abdou-da0wew/violin/errors';

throw new AppError(ErrorCode.NOT_FOUND_RESOURCE, 'Resource not found', {
  statusCode: 404,
  context: { resourceId: 'resource_123' },
});
```

`AppError` carries a stable code, an HTTP status, structured context, and an optional cause. Its `toJSON()` method intentionally excludes stack traces, causes, and internal context. By default, 4xx messages are exposed; 5xx errors use a generic client-facing message.

## Performance and safety by design

- Disabled log levels return before timestamp creation, mixins, serializers, redaction, and transport calls.
- The core logger has no required runtime dependencies.
- Child loggers share transport instances instead of allocating new queues or file handles.
- File writes are batched through a bounded queue and a single drain loop.
- Discord events are sent sequentially through a bounded queue with timeout and retry handling.
- Secret-like keys and common credential patterns are redacted before transport delivery by default.
- Transport failures are isolated from the application code that emitted the log.

These are implementation choices, not a benchmark claim. No performance comparison is published yet; measure Violin against your own workload before making latency-critical decisions. See [Performance and tuning](docs/performance.md).

## Documentation

| Guide | Contents |
|---|---|
| [Getting started](docs/getting-started.md) | Installation, first logger, structured events, shutdown |
| [Configuration](docs/configuration.md) | Levels, options, bindings, serializers, mixins, sampling |
| [Fastify integration](docs/fastify.md) | `loggerInstance`, request context, error handling, Fastify 4/5 |
| [Pino migration](docs/migration-from-pino.md) | Supported APIs, differences, migration checklist |
| [Transports](docs/transports.md) | Console, file, Discord, and custom transports |
| [Application errors](docs/errors.md) | `AppError`, error codes, safe serialization |
| [Security](docs/security.md) | Redaction, sensitive data, deployment considerations |
| [Performance](docs/performance.md) | Hot path, batching, queue sizing, benchmarking guidance |
| [Architecture](docs/architecture.md) | Pipeline, ownership, transport lifecycle, package layout |
| [Troubleshooting](docs/troubleshooting.md) | Common integration and runtime issues |
| [API reference](docs/api.md) | Public classes, methods, types, and exports |

## Package exports

```ts
import { createLogger, FileTransport } from '@abdou-da0wew/violin';
import { createFastifyLogger } from '@abdou-da0wew/violin/fastify';
import { AppError, ErrorCode } from '@abdou-da0wew/violin/errors';
import { DiscordTransport } from '@abdou-da0wew/violin/transports';
```

The package ships ESM, CommonJS, and TypeScript declaration files.

## Development

Requirements: Bun 1.4+ and Node.js 20+ for compatibility smoke tests.

```bash
git clone https://github.com/abdou-da0wew/violin.git
cd violin
bun install --frozen-lockfile

bun run typecheck
bun test
bun run build
npm pack --dry-run
```

The test suite covers the logger hot path, structured argument forms, child bindings, redaction, transport failure handling, file output and rotation, Discord delivery, application errors, and Fastify integration.

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Please report security vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## License

Violin is released under the [MIT License](LICENSE).

---

<div align="center">

Maintained by [abdou-da0wew](https://github.com/abdou-da0wew).

</div>
