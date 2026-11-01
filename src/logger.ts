import { format as formatMessage } from 'node:util';
import { ConsoleTransport } from './transports/console.js';
import { isAtLeast, isLogLevel, normalizeLevel } from './levels.js';
import { redactFields, redactText, serializeError } from './redaction.js';
import { LEVEL_SEVERITY, type LogEntry, type LogFields, type LogLevel, type LoggerLevel, type LoggerOptions, type Transport } from './types.js';

export type LogMethod = (...args: unknown[]) => void;

/**
 * Structured logger with a synchronous, allocation-conscious hot path.
 * Disabled messages are rejected before timestamps, serializers, mixins or
 * redaction run. Transports are shared by child loggers and own their buffers.
 */
export class Logger {
  private readonly transports: Transport[];
  private readonly options: LoggerOptions;
  private readonly bindingsValue: LogFields;
  private currentLevel: LoggerLevel;
  private closed = false;

  constructor(options?: LoggerOptions | Transport[], legacyLevel?: string) {
    const normalizedOptions: LoggerOptions = Array.isArray(options)
      ? { transports: options, ...(legacyLevel ? { level: legacyLevel } : {}) }
      : (options ?? {});

    this.options = normalizedOptions;
    const sampleRate = normalizedOptions.sampleRate ?? 1;
    if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
      throw new RangeError('sampleRate must be a finite number between 0 and 1');
    }
    this.transports = normalizedOptions.transports ?? [new ConsoleTransport()];
    this.bindingsValue = { ...(normalizedOptions.base ?? {}), ...(normalizedOptions.bindings ?? {}) };
    const envLevel = typeof process !== 'undefined' ? process.env.LOG_LEVEL : undefined;
    this.currentLevel = normalizeLevel(normalizedOptions.level ?? envLevel, 'INFO');
  }

  /** Current threshold. Accepts every built-in level plus `silent`. */
  get level(): LoggerLevel {
    return this.currentLevel;
  }

  set level(value: LoggerLevel) {
    this.setLevel(value);
  }

  setLevel(value: string): this {
    const normalized = normalizeLevel(value, this.currentLevel);
    if (normalized !== value.toUpperCase() && normalized !== 'silent') {
      throw new RangeError(`Unknown log level: ${value}`);
    }
    this.currentLevel = normalized;
    return this;
  }

  getLevel(): LoggerLevel {
    return this.currentLevel;
  }

  isEnabled(level: LogLevel): boolean {
    return !this.closed && isAtLeast(level, this.currentLevel);
  }

  isLevelEnabled(level: string): boolean {
    const normalized = level.toUpperCase();
    return isLogLevel(normalized) && this.isEnabled(normalized as LogLevel);
  }

  /** Returns a shallow copy of the fields bound to this logger. */
  bindings(): LogFields {
    return { ...this.bindingsValue };
  }

  /** Child loggers share transports and configuration but have isolated bindings. */
  child(bindings: LogFields, options?: { level?: LoggerLevel | string }): Logger {
    const { bindings: _originalBindings, ...sharedOptions } = this.options;
    return new Logger({
      ...sharedOptions,
      transports: this.transports,
      level: options?.level ?? this.currentLevel,
      base: { ...this.bindingsValue, ...bindings },
    });
  }

  trace(message: string, fields?: LogFields): void;
  trace(fields: LogFields, message?: string): void;
  trace(error: Error, message?: string): void;
  trace(...args: unknown[]): void { this.write('TRACE', args); }

  debug(message: string, fields?: LogFields): void;
  debug(fields: LogFields, message?: string): void;
  debug(error: Error, message?: string): void;
  debug(...args: unknown[]): void { this.write('DEBUG', args); }

  build(message: string, fields?: LogFields): void;
  build(fields: LogFields, message?: string): void;
  build(...args: unknown[]): void { this.write('BUILD', args); }

  info(message: string, fields?: LogFields): void;
  info(fields: LogFields, message?: string): void;
  info(error: Error, message?: string): void;
  info(...args: unknown[]): void { this.write('INFO', args); }

  success(message: string, fields?: LogFields): void;
  success(fields: LogFields, message?: string): void;
  success(...args: unknown[]): void { this.write('SUCCESS', args); }

  warn(message: string, fields?: LogFields): void;
  warn(fields: LogFields, message?: string): void;
  warn(error: Error, message?: string): void;
  warn(...args: unknown[]): void { this.write('WARN', args); }

  error(message: string, errorOrFields?: unknown, fields?: LogFields): void;
  error(fields: LogFields, message?: string): void;
  error(error: Error, message?: string, fields?: LogFields): void;
  error(...args: unknown[]): void { this.write('ERROR', args); }

  critical(message: string, errorOrFields?: unknown, fields?: LogFields): void;
  critical(fields: LogFields, message?: string): void;
  critical(error: Error, message?: string, fields?: LogFields): void;
  critical(...args: unknown[]): void { this.write('CRITICAL', args); }

  fatal(message: string, errorOrFields?: unknown, fields?: LogFields): void;
  fatal(fields: LogFields, message?: string): void;
  fatal(error: Error, message?: string, fields?: LogFields): void;
  fatal(...args: unknown[]): void { this.write('FATAL', args); }

  /** Pino-compatible no-op. */
  silent(..._args: unknown[]): void {}

  /** Explicit lower-level method for custom and dynamically selected levels. */
  log(level: LogLevel, ...args: unknown[]): void {
    this.write(level, args);
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.transports.map(transport => transport.flush?.()));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled(this.transports.map(transport => transport.close?.()));
  }

  /** Alias for close(), suitable for resource-disposal code. */
  async destroy(): Promise<void> {
    await this.close();
  }

  private write(level: LogLevel, args: unknown[]): void {
    if (!this.isEnabled(level)) return;

    const sampleRate = this.options.sampleRate ?? 1;
    if (sampleRate <= 0 || (sampleRate < 1 && Math.random() >= sampleRate)) return;

    const parsed = parseArguments(args);
    const mixin = this.options.mixin?.();
    const rawFields = mixin || parsed.fields
      ? { ...(mixin ?? {}), ...(parsed.fields ?? {}) }
      : undefined;
    const redaction = this.options.redact === false ? false : (this.options.redact && typeof this.options.redact === 'object' ? this.options.redact : {});
    const fields = rawFields ? redactFields(rawFields, redaction, this.options.serializers) : undefined;
    const bindings = Object.keys(this.bindingsValue).length > 0
      ? redactFields(this.bindingsValue, redaction, this.options.serializers)
      : undefined;
    const timestampOption = this.options.timestamp ?? true;
    const timestamp = typeof timestampOption === 'function'
      ? timestampOption()
      : timestampOption ? new Date().toISOString() : undefined;
    const time = timestamp ? Date.parse(timestamp) || Date.now() : Date.now();

    const entry: LogEntry = {
      level,
      severity: LEVEL_SEVERITY[level],
      message: this.options.redact === false ? parsed.message : redactText(parsed.message),
      time,
      ...(timestamp ? { timestamp } : {}),
      ...(bindings ? { bindings } : {}),
      ...(fields ? { fields } : {}),
      ...(parsed.error ? { error: serializeError(parsed.error, this.options.redact !== false) } : {}),
    };

    for (const transport of this.transports) {
      if (transport.supports && !transport.supports(level)) continue;
      try {
        transport.log(entry);
      } catch (error) {
        try { this.options.onTransportError?.(error, transport); } catch { /* logging errors stay non-fatal */ }
      }
    }
  }
}

function parseArguments(args: unknown[]): { message: string; fields?: LogFields; error?: Error } {
  const [first, second, third, ...rest] = args;

  if (typeof first === 'string') {
    if (second instanceof Error) {
      return {
        message: first,
        error: second,
        ...(isPlainObject(third) ? { fields: third as LogFields } : {}),
      };
    }
    if (isPlainObject(second)) {
      return { message: first, fields: second as LogFields };
    }
    if (second !== undefined || rest.length > 0) {
      const values = [second, third, ...rest].filter(value => value !== undefined);
      try { return { message: formatMessage(first, ...values) }; } catch { return { message: first }; }
    }
    return { message: first };
  }

  if (first instanceof Error) {
    return {
      message: typeof second === 'string' ? second : first.message,
      error: first,
      ...(isPlainObject(second) ? { fields: second as LogFields } : isPlainObject(third) ? { fields: third as LogFields } : {}),
    };
  }

  if (isPlainObject(first)) {
    return {
      message: typeof second === 'string' ? second : '',
      fields: first as LogFields,
      ...(third instanceof Error ? { error: third } : {}),
    };
  }

  if (first === undefined) return { message: typeof second === 'string' ? second : '' };
  return { message: String(first) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Error) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}


export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}

export type { LoggerOptions, LogFields, LogEntry, LogLevel, LoggerLevel, Transport } from './types.js';
