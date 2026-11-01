# Fastify integration

Violin's Fastify adapter implements Fastify's base logger interface and can be passed as `loggerInstance`. It does not depend on Pino at runtime.

## Basic setup

```ts
import Fastify from 'fastify';
import { createLogger, FileTransport } from '@abdou-da0wew/violin';
import { createFastifyLogger } from '@abdou-da0wew/violin/fastify';

const violin = createLogger({
  level: process.env.LOG_LEVEL ?? 'INFO',
  base: { service: 'catalog-api' },
  transports: [
    // Console is not added automatically when an explicit list is supplied.
    new FileTransport({ directory: './logs', level: 'INFO' }),
  ],
});

const app = Fastify({ loggerInstance: createFastifyLogger(violin) });
app.get('/health', async () => ({ ok: true }));

await app.listen({ host: '0.0.0.0', port: 3000 });
```

When supplying an explicit `transports` array, add a `ConsoleTransport` yourself if you also want console output.

## Request context

Fastify creates child logger instances with request-specific bindings. The adapter forwards these to Violin child loggers, so request ID and other Fastify bindings are part of every request log entry. For built-in request/response events, it reduces `req` to a small summary (`id`, method, URL, hostname, and socket address/port) and `res` to `statusCode`. Request headers and query strings are deliberately omitted to avoid credential leakage and expensive traversal of the full Fastify request object.

## Avoid duplicate request logs

Fastify's automatic request logging is enabled by default. Keep it enabled if you want the normal request lifecycle events. In Fastify v5, use `logController` to customize or suppress those events. Fastify v4 exposes the older top-level `disableRequestLogging` setting.

## Pino-style API migration

Common Pino patterns are supported:

```ts
logger.info({ userId }, 'User signed in');
logger.error({ err }, 'Operation failed');
logger.child({ module: 'payments' });
```

Violin additionally supports message-first calls:

```ts
logger.info('User signed in', { userId });
logger.error(error, 'Operation failed');
```

The adapter covers Fastify's standard logger methods (`trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`), mutable `level`, and `child()`. It is intended as a Fastify replacement for the default Pino logger instance, not a complete implementation of every Pino extension, hook, transport, redaction syntax, or custom level API. Pino-specific methods such as `flush()`, `bindings()` and `isLevelEnabled()` are available on the underlying Violin instance, not part of Fastify's base logger contract.

## Fastify v4 and v5

The adapter is typed against Fastify's exported `FastifyBaseLogger` interface. The package declares Fastify as an optional peer dependency (`>=4 <6`); install the same Fastify major version already used by your application. If a particular Fastify minor changes its logger type contract, use the matching Violin release after checking this guide and the TypeScript compiler output.

## Errors and HTTP responses

Use an error handler to translate application errors into safe payloads:

```ts
import { AppError, toAppError } from '@abdou-da0wew/violin/errors';

app.setErrorHandler((error, request, reply) => {
  const appError = toAppError(error);
  request.log.error(appError, 'Request failed');
  return reply.code(appError.statusCode).send(appError.toJSON());
});
```

Do not expose raw unknown error messages or stack traces to clients. The default `toAppError()` fallback uses a generic 500 response.
