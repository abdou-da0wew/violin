import { isAtLeast, normalizeLevel } from '../levels.js';
import type { ConsoleTransportOptions, LogEntry, LogLevel, LoggerLevel, Transport } from '../types.js';

const ANSI: Record<LogLevel, string> = {
  TRACE: '\u001b[90m', DEBUG: '\u001b[90m', BUILD: '\u001b[38;5;208m', INFO: '\u001b[36m',
  SUCCESS: '\u001b[32m', WARN: '\u001b[33m', ERROR: '\u001b[31m', CRITICAL: '\u001b[91m', FATAL: '\u001b[41;97m',
};
const RESET = '\u001b[0m';

export class ConsoleTransport implements Transport {
  readonly name = 'console';
  private readonly minLevel: LoggerLevel;
  private readonly format: 'pretty' | 'json' | 'auto';
  private readonly colors: boolean | 'auto';
  private readonly stdout: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
  private readonly stderr: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
  private readonly appName: string | undefined;

  constructor(options: ConsoleTransportOptions = {}) {
    this.minLevel = normalizeLevel(options.level, 'TRACE');
    this.format = options.format ?? 'auto';
    this.colors = options.colors ?? 'auto';
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.appName = options.appName;
  }

  supports(level: LogLevel): boolean { return isAtLeast(level, this.minLevel); }

  log(entry: LogEntry): void {
    const useJson = this.format === 'json' || (this.format === 'auto' && !this.stdout.isTTY);
    const line = useJson ? JSON.stringify(entry) : this.pretty(entry);
    const stream = entry.severity >= 50 ? this.stderr : this.stdout;
    stream.write(`${line}\n`);
  }

  private pretty(entry: LogEntry): string {
    const colorEnabled = this.colors === true || (this.colors === 'auto' && Boolean(this.stdout.isTTY));
    const label = `[${entry.level}]`;
    const prefix = colorEnabled ? `${ANSI[entry.level]}${label}${RESET}` : label;
    const timestamp = entry.timestamp ? `${entry.timestamp} ` : '';
    const app = this.appName ? `[${this.appName}] ` : '';
    const bindings = entry.bindings ? ` ${safeJson(entry.bindings)}` : '';
    const fields = entry.fields ? ` ${safeJson(entry.fields)}` : '';
    const error = entry.error ? `\n  ${entry.error.name}: ${entry.error.message}${entry.error.stack ? `\n${entry.error.stack}` : ''}` : '';
    return `${timestamp}${app}${prefix} ${entry.message}${bindings}${fields}${error}`;
  }
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value); } catch { return '"[Unserializable]"'; }
}
