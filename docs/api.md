# API reference

## `createLogger(options?)`

Returns a `Logger`. With no options, Violin creates a console transport and uses `INFO` as the threshold.

## `Logger`

### Levels

`trace`, `debug`, `build`, `info`, `success`, `warn`, `error`, `critical`, `fatal`, `silent`, and `log(level, ...args)`.

Each level accepts message-first or object-first arguments. Error methods additionally accept an `Error` instance:

```ts
logger.error('Message', error, { operation: 'save' });
logger.error(error, 'Message');
logger.error({ operation: 'save' }, 'Message');
```

### State and context

- `level`: get or set the threshold.
- `setLevel(level)`: validate and change the threshold.
- `getLevel()`: read the current threshold.
- `isEnabled(level)` / `isLevelEnabled(level)`: test whether a level is enabled.
- `bindings()`: return a shallow copy of the logger's bindings.
- `child(bindings, options?)`: create a logger with merged context and shared transports.

### Lifecycle

- `flush()`: wait for transport buffers to flush.
- `close()`: flush and release transports. Idempotent.
- `destroy()`: alias for `close()`.

A child shares transports with its parent. Only the owner/root logger should close them.

## LogEntry

```ts
interface LogEntry {
  level: LogLevel;
  severity: number;
  message: string;
  time: number; // epoch milliseconds
  timestamp?: string; // ISO-8601
  bindings?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  error?: SerializedError;
}
```

## Transports

- `ConsoleTransport(options?)`
- `FileTransport(options)`
- `DiscordTransport(options)`

Implement `Transport` to add a custom sink. `log(entry)` must not block on I/O.

## Fastify subpath

Import from `@abdou-da0wew/violin/fastify`:

- `createFastifyLogger(loggerOrOptions?)`
- `asFastifyLogger(logger)`
- `FastifyLoggerAdapter`

## Errors subpath

Import from `@abdou-da0wew/violin/errors`:

- `AppError`
- `toAppError`
- `ErrorCode`
- `defineErrorCodes`

## Utility exports

The root entry also exports log level constants and helpers, redaction utilities, public configuration types, and transport types. See generated declaration files under `dist/` for the exact TypeScript signatures.
