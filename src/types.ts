export const LOG_LEVELS = ['TRACE', 'DEBUG', 'BUILD', 'INFO', 'SUCCESS', 'WARN', 'ERROR', 'CRITICAL', 'FATAL'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LoggerLevel = LogLevel | 'silent';
export type LogFields = Record<string, unknown>;

export const LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = {
  TRACE: 5, DEBUG: 10, BUILD: 20, INFO: 30, SUCCESS: 30, WARN: 40, ERROR: 50, CRITICAL: 60, FATAL: 70,
};

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: SerializedError | unknown;
}

export interface LogEntry {
  level: LogLevel;
  severity: number;
  message: string;
  /** Unix epoch milliseconds. */
  time: number;
  /** ISO-8601 timestamp. Can be disabled to reduce allocations. */
  timestamp?: string;
  bindings?: LogFields;
  fields?: LogFields;
  error?: SerializedError;
}

/** A transport must keep its synchronous `log` method non-blocking. */
export interface Transport {
  readonly name?: string;
  supports?(level: LogLevel): boolean;
  log(entry: LogEntry): void;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface RedactionOptions {
  paths?: string[];
  censor?: string;
  remove?: boolean;
  redactText?: boolean;
}

export interface LoggerOptions {
  level?: LoggerLevel | (string & {});
  transports?: Transport[];
  base?: LogFields;
  bindings?: LogFields;
  redact?: boolean | RedactionOptions;
  timestamp?: boolean | (() => string);
  serializers?: Record<string, (value: unknown) => unknown>;
  onTransportError?: (error: unknown, transport: Transport) => void;
  mixin?: () => LogFields;
  sampleRate?: number;
}

export interface ConsoleTransportOptions {
  level?: LoggerLevel | string;
  format?: 'auto' | 'pretty' | 'json';
  colors?: boolean | 'auto';
  stdout?: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
  stderr?: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
  appName?: string;
}

export interface FileTransportOptions {
  directory: string;
  level?: LoggerLevel | string;
  maxSize?: number;
  maxFiles?: number;
  maxQueueSize?: number;
  batchSize?: number;
  flushIntervalMs?: number;
}

export interface DiscordTransportOptions {
  webhookUrl: string;
  level?: LoggerLevel | string;
  username?: string;
  avatarUrl?: string;
  maxQueueSize?: number;
  flushIntervalMs?: number;
  requestTimeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  fetch?: typeof globalThis.fetch;
  levels?: LogLevel[];
}

/** Compatibility aliases for consumers familiar with the original interfaces. */
export type ILogEntry = LogEntry;
export type ITransport = Transport;
