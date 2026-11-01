# Application errors

Violin includes an error model that started from the reusable error utilities in Triecbot and was generalized for independent projects.

## AppError

```ts
import { AppError } from '@abdou-da0wew/violin/errors';

throw new AppError('PAYMENT_DECLINED', 'The payment method was declined', {
  statusCode: 422,
  context: { orderId: 'order_123' },
  cause: providerError,
});
```

Options:

- `statusCode`: integer HTTP status from 400 through 599. Defaults to 500.
- `context`: structured internal metadata. Never included in `toJSON()`.
- `cause`: original exception or underlying failure.
- `expose`: whether `message` may be sent to the client. Defaults to `statusCode < 500`.

The legacy constructor is supported too:

```ts
new AppError('INTERNAL_ERROR', 'Database failed', 500, { operation: 'connect' });
```

`toJSON()` returns `{ error: { code, message } }`. It never includes stack, cause, or context. Non-exposed errors use the generic message `Internal server error.`.

## Normalize unknown errors

```ts
const normalized = toAppError(error);
```

Existing `AppError` instances are returned unchanged. Unknown thrown values become an internal 500 error and retain the original value as `cause`. The original error message is not sent to clients.

Provide controlled fallbacks when the boundary has more context:

```ts
const normalized = toAppError(error, {
  fallbackCode: 'REPORT_GENERATION_FAILED',
  fallbackMessage: 'Unable to generate the report.',
  statusCode: 503,
  context: { reportId },
});
```

## Error codes

`ErrorCode` includes common authentication, authorization, validation, lookup, rate-limit, conflict, external-system, economy, and internal codes. Applications can extend it:

```ts
import { defineErrorCodes } from '@abdou-da0wew/violin/errors';

export const BillingErrorCode = defineErrorCodes({
  PAYMENT_DECLINED: 'PAYMENT_DECLINED',
  REFUND_WINDOW_CLOSED: 'REFUND_WINDOW_CLOSED',
});
```

Use stable codes in API responses, logs, and monitoring. Do not generate codes from arbitrary error messages.
