# Security

Logging is a data-exfiltration boundary. Violin enables defensive redaction by default, but no automatic redaction can identify every secret or personal datum in arbitrary application payloads.

## Built-in protections

- Secret-like object keys are censored, including names resembling token, secret, password, authorization, API key, cookie, bearer, passphrase, private key, client secret, and access key.
- Common credential assignments and bearer tokens in free-form strings are redacted.
- `Error` instances are normalized; stack and message text pass through text redaction.
- Circular references, deep objects, functions, symbols, bigint values, and typed arrays are normalized to safe representations instead of causing serialization crashes.
- Discord messages disable automatic mentions.
- Application error response payloads omit stack traces, causes, and internal context.

## Add application-specific paths

```ts
const logger = createLogger({
  redact: {
    paths: [
      'user.email',
      'request.headers.x-api-key',
      'oauth.refreshToken',
      'payment.card.number',
    ],
    censor: '[REDACTED]',
  },
});
```

Paths support `*` as one path segment, for example `sessions.*.refreshToken`.

## Important limitations

- Redaction is defense in depth, not permission to log credentials. Never log passwords, authorization headers, session cookies, access tokens, or full payment data intentionally.
- Pattern-based text redaction is best effort. Custom formats, encoded secrets, multiline values, binary payloads, and application-specific secret names may evade detection.
- Custom serializers run before redaction. They should return only fields that are useful and safe to log.
- If you set `redact: false`, you take responsibility for sanitizing every message, field, and error.
- Logs may contain personal data even after secret redaction. Apply retention, access control, and data minimization policies to your log storage.
- File transport is designed for a single process per output directory. Use stdout aggregation or process-specific directories in multi-process deployments.
- Discord webhooks are credentials. Load them from environment/secret managers and rotate them if exposed.
