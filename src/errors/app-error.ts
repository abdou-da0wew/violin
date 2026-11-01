import { ErrorCode, type AppErrorCode } from './error-code.js';
import type { LogFields } from '../types.js';

export interface AppErrorOptions {
  statusCode?: number;
  context?: LogFields;
  cause?: unknown;
  /** Whether a boundary may safely return this message to a client. */
  expose?: boolean;
}

export interface AppErrorPayload {
  error: {
    code: string;
    message: string;
  };
}

/** An application error with a stable code, HTTP status and optional context. */
export class AppError<TCode extends AppErrorCode = AppErrorCode> extends Error {
  readonly code: TCode;
  readonly statusCode: number;
  readonly context: LogFields;
  readonly expose: boolean;
  override readonly cause: unknown;

  constructor(code: TCode, message: string, options?: AppErrorOptions);
  /** Legacy-compatible constructor: new AppError(code, message, statusCode, context). */
  constructor(code: TCode, message: string, statusCode?: number, context?: LogFields);
  constructor(code: TCode, message: string, optionsOrStatus: AppErrorOptions | number = {}, legacyContext: LogFields = {}) {
    const options: AppErrorOptions = typeof optionsOrStatus === 'number'
      ? { statusCode: optionsOrStatus, context: legacyContext }
      : optionsOrStatus;
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = normalizeStatusCode(options.statusCode ?? 500);
    this.context = options.context ?? {};
    this.expose = options.expose ?? this.statusCode < 500;
    this.cause = options.cause;
    Error.captureStackTrace?.(this, AppError);
  }

  /** Safe by default: no stack, cause, or internal context is exposed. */
  toJSON(): AppErrorPayload {
    return { error: { code: this.code, message: this.expose ? this.message : 'Internal server error.' } };
  }

  toResponse(): AppErrorPayload {
    return this.toJSON();
  }
}

export interface ToAppErrorOptions {
  fallbackCode?: AppErrorCode;
  fallbackMessage?: string;
  statusCode?: number;
  context?: LogFields;
  expose?: boolean;
}

/**
 * Normalize unknown thrown values without trusting or exposing their messages.
 * Existing AppErrors are returned unchanged.
 */
export function toAppError(error: unknown, options: ToAppErrorOptions = {}): AppError {
  if (error instanceof AppError) return error;
  return new AppError(
    options.fallbackCode ?? ErrorCode.INTERNAL_ERROR,
    options.fallbackMessage ?? 'Internal server error.',
    {
      statusCode: options.statusCode ?? 500,
      ...(options.context ? { context: options.context } : {}),
      cause: error,
      expose: options.expose ?? false,
    },
  );
}

function normalizeStatusCode(statusCode: number): number {
  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
    throw new RangeError(`Invalid application error status code: ${statusCode}`);
  }
  return statusCode;
}
