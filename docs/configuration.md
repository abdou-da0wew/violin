# Configuration

`createLogger(options)` accepts the following options.

| Option | Type | Default | Description |
|---|---|---|---|
| `level` | `LoggerLevel` | `INFO` | Global threshold, or `silent`. |
| `transports` | `Transport[]` | Console transport | Output destinations. |
| `base` | `LogFields` | `{}` | Fields attached to every entry. |
| `bindings` | `LogFields` | `{}` | Additional base fields; overrides matching `base` keys. |
| `redact` | `boolean \| RedactionOptions` | `true` | Redact common secrets and configured paths. |
| `timestamp` | `boolean \| (() => string)` | `true` | ISO timestamp generation. `time` epoch milliseconds is always included. |
| `serializers` | `Record<string, (value: unknown) => unknown>` | `{}` | Top-level field serializers. |
| `mixin` | `() => LogFields` | none | Extra fields, evaluated only for enabled calls. |
| `sampleRate` | `number` | `1` | Random sampling ratio between 0 and 1. |
| `onTransportError` | `(error, transport) => void` | none | Observe transport failures. This callback must not throw. |

## Log levels

From least to most severe:

`TRACE` (5), `DEBUG` (10), `BUILD` (20), `INFO` (30), `SUCCESS` (30), `WARN` (40), `ERROR` (50), `CRITICAL` (60), `FATAL` (70).

A logger set to `WARN` emits `WARN` and more severe events. `SUCCESS` is intentionally equivalent to `INFO` in severity. `silent` disables all output. Thresholds can be changed at runtime:

```ts
logger.level = 'DEBUG';
logger.setLevel('WARN');
console.log(logger.getLevel());
```

An unknown level passed to `setLevel()` throws a `RangeError`. Unknown levels in initial configuration fall back to `INFO`.

## Child loggers

```ts
const appLogger = createLogger({ base: { service: 'api' } });
const requestLogger = appLogger.child({ requestId: 'req_123', userId: 'user_42' });
requestLogger.info('Request accepted');
```

Child bindings are merged with parent bindings. A child may override its threshold:

```ts
const noisySubsystem = appLogger.child({ subsystem: 'database' }, { level: 'DEBUG' });
```

Child loggers share the original transports. Close the root logger, not every child.

## Redaction options

```ts
const logger = createLogger({
  redact: {
    paths: ['user.email', 'headers.x-internal-key', 'sessions.*.refreshToken'],
    censor: '[hidden]',
    remove: false,
    redactText: true,
  },
});
```

The built-in key matcher redacts keys resembling tokens, secrets, passwords, authorization, API keys, cookies, bearer credentials, passphrases, private keys, client secrets, and access keys. `paths` adds exact paths or `*` path segments. `remove: true` removes matched keys instead of replacing values. See [Security](security.md) for limitations.

To fully disable redaction, set `redact: false`. This is generally not appropriate in production.

## Serializers and mixins

Serializers are selected by top-level field name and run before redaction:

```ts
const logger = createLogger({
  serializers: {
    request(value) {
      const request = value as { method?: string; url?: string; headers?: Record<string, string> };
      return { method: request.method, url: request.url, headers: request.headers };
    },
  },
  mixin: () => ({ release: process.env.RELEASE_ID ?? 'local' }),
});
```

A serializer that throws is replaced with `[SerializerError]`. Mixins are application callbacks and should be fast and side-effect-free. A mixin is not evaluated for disabled log levels.
