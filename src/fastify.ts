import type { FastifyBaseLogger } from 'fastify';
import { createLogger, Logger } from './logger.js';
import type { LoggerOptions, LogLevel } from './types.js';

/**
 * A Pino-shaped adapter accepted by Fastify's `loggerInstance` option.
 * No Pino runtime dependency is used. Request child loggers retain Fastify's
 * request bindings and share the same transport instances.
 */
export class FastifyLoggerAdapter implements FastifyBaseLogger {
  constructor(private readonly logger: Logger) {}

  get level(): string { return this.logger.level; }
  set level(value: string) { this.logger.setLevel(value); }

  trace(...args: Parameters<FastifyBaseLogger['trace']>): void { this.write('TRACE', args); }
  debug(...args: Parameters<FastifyBaseLogger['debug']>): void { this.write('DEBUG', args); }
  info(...args: Parameters<FastifyBaseLogger['info']>): void { this.write('INFO', args); }
  warn(...args: Parameters<FastifyBaseLogger['warn']>): void { this.write('WARN', args); }
  error(...args: Parameters<FastifyBaseLogger['error']>): void { this.write('ERROR', args); }
  fatal(...args: Parameters<FastifyBaseLogger['fatal']>): void { this.write('FATAL', args); }
  silent(..._args: Parameters<FastifyBaseLogger['silent']>): void {}

  child(bindings: Record<string, unknown>): FastifyBaseLogger {
    return new FastifyLoggerAdapter(this.logger.child(bindings));
  }

  private write(level: LogLevel, args: unknown[]): void {
    const first = args[0];
    if (isRecord(first) && ('req' in first || 'res' in first)) {
      const fields = { ...first };
      if ('req' in fields) fields.req = serializeRequest(fields.req);
      if ('res' in fields) fields.res = serializeReply(fields.res);
      this.logger.log(level, fields, ...args.slice(1));
      return;
    }
    this.logger.log(level, ...args);
  }
}

export function createFastifyLogger(logger?: Logger | LoggerOptions): FastifyBaseLogger {
  const instance = logger instanceof Logger ? logger : createLogger(logger ?? {});
  return new FastifyLoggerAdapter(instance);
}

export function asFastifyLogger(logger: Logger): FastifyBaseLogger {
  return new FastifyLoggerAdapter(logger);
}

/** Avoid traversing the huge request object and never copy request headers by default. */
function serializeRequest(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { value: safePrimitive(value) };
  const raw = isRecord(value.raw) ? value.raw : {};
  const socket = isRecord(raw.socket) ? raw.socket : isRecord(value.socket) ? value.socket : {};
  return {
    ...(value.id !== undefined ? { id: safePrimitive(value.id) } : {}),
    ...(value.method !== undefined ? { method: safePrimitive(value.method) } : {}),
    ...(value.url !== undefined ? { url: safeRequestPath(value.url) } : {}),
    ...(value.hostname !== undefined ? { hostname: safePrimitive(value.hostname) } : {}),
    ...(socket.remoteAddress !== undefined ? { remoteAddress: safePrimitive(socket.remoteAddress) } : {}),
    ...(socket.remotePort !== undefined ? { remotePort: safePrimitive(socket.remotePort) } : {}),
  };
}

/** Response headers and internals are intentionally omitted. */
function serializeReply(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { value: safePrimitive(value) };
  return value.statusCode === undefined ? {} : { statusCode: safePrimitive(value.statusCode) };
}

function safeRequestPath(value: unknown): string {
  if (typeof value !== 'string') return String(value);
  const queryIndex = value.indexOf('?');
  const fragmentIndex = value.indexOf('#');
  const end = [queryIndex, fragmentIndex].filter(index => index >= 0).reduce((current, index) => Math.min(current, index), value.length);
  return value.slice(0, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safePrimitive(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}
