import { isAtLeast, normalizeLevel } from '../levels.js';
import type { DiscordTransportOptions, LogEntry, LogLevel, LoggerLevel, Transport } from '../types.js';

const DEFAULT_LEVELS: readonly LogLevel[] = ['ERROR', 'CRITICAL', 'FATAL'];
const COLORS: Record<LogLevel, number> = {
  TRACE: 0x95a5a6, DEBUG: 0x7f8c8d, BUILD: 0xe67e22, INFO: 0x3498db, SUCCESS: 0x2ecc71,
  WARN: 0xf1c40f, ERROR: 0xe74c3c, CRITICAL: 0xe84393, FATAL: 0x000000,
};

/** Bounded, sequential Discord webhook transport with timeout and 429 backoff. */
export class DiscordTransport implements Transport {
  readonly name = 'discord';
  private readonly webhookUrl: string;
  private readonly minLevel: LoggerLevel;
  private readonly username: string;
  private readonly avatarUrl: string | undefined;
  private readonly maxQueueSize: number;
  private readonly flushIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly acceptedLevels: readonly LogLevel[];
  private readonly queue: LogEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private drainPromise: Promise<void> | null = null;
  private backoffUntil = 0;
  private backoffMs = 0;
  private dropped = 0;
  private closed = false;

  constructor(options: DiscordTransportOptions) {
    this.webhookUrl = options.webhookUrl;
    this.minLevel = normalizeLevel(options.level, 'TRACE');
    this.username = options.username ?? 'Application Logger';
    this.avatarUrl = options.avatarUrl;
    this.maxQueueSize = Math.max(1, options.maxQueueSize ?? 100);
    this.flushIntervalMs = Math.max(100, options.flushIntervalMs ?? 1000);
    this.requestTimeoutMs = Math.max(500, options.requestTimeoutMs ?? 5000);
    this.baseBackoffMs = Math.max(100, options.baseBackoffMs ?? 1000);
    this.maxBackoffMs = Math.max(this.baseBackoffMs, options.maxBackoffMs ?? 30_000);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.acceptedLevels = options.levels ?? DEFAULT_LEVELS;

    this.timer = setInterval(() => this.scheduleDrain(), this.flushIntervalMs);
    this.timer.unref();
  }

  supports(level: LogLevel): boolean {
    return Boolean(this.webhookUrl) && this.acceptedLevels.includes(level) && isAtLeast(level, this.minLevel);
  }

  log(entry: LogEntry): void {
    if (this.closed || !this.supports(entry.level)) return;
    if (this.queue.length >= this.maxQueueSize) {
      this.dropped++;
      return;
    }
    this.queue.push(entry);
    this.scheduleDrain();
  }

  getStats(): { queued: number; dropped: number; backoffMs: number } {
    return { queued: this.queue.length, dropped: this.dropped, backoffMs: Math.max(0, this.backoffUntil - Date.now()) };
  }

  async flush(): Promise<void> {
    this.scheduleDrain(true);
    await this.drainPromise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    if (this.queue.length > 0) {
      this.dropped += this.queue.length;
      this.queue.length = 0;
    }
  }

  private scheduleDrain(force = false): void {
    if (this.drainPromise || this.queue.length === 0 || this.closed && !force) return;
    if (!force && Date.now() < this.backoffUntil) return;
    this.drainPromise = this.drain().finally(() => { this.drainPromise = null; });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const entry = this.queue[0]!;
      const retryAfter = await this.post(entry);
      if (retryAfter > 0) {
        this.backoffMs = retryAfter;
        this.backoffUntil = Date.now() + retryAfter;
        return;
      }
      this.queue.shift();
      this.backoffMs = 0;
      this.backoffUntil = 0;
    }
  }

  private async post(entry: LogEntry): Promise<number> {
    const fields = { ...(entry.bindings ?? {}), ...(entry.fields ?? {}) };
    const fieldEntries = Object.entries(fields).slice(0, 20).map(([name, value]) => ({
      name: truncate(name.replace(/`/g, ''), 256),
      value: truncate(formatValue(value), 1024),
      inline: true,
    }));

    try {
      const response = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
        body: JSON.stringify({
          username: this.username,
          ...(this.avatarUrl ? { avatar_url: this.avatarUrl } : {}),
          allowed_mentions: { parse: [] },
          embeds: [{
            title: `${entry.level}${entry.bindings?.service ? ` · ${String(entry.bindings.service)}` : ''}`,
            description: truncate(entry.message || '(empty message)', 4096),
            color: COLORS[entry.level],
            ...(entry.timestamp ? { timestamp: entry.timestamp } : {}),
            ...(fieldEntries.length > 0 ? { fields: fieldEntries } : {}),
            ...(entry.error ? { footer: { text: `${entry.error.name}: ${truncate(entry.error.message, 1800)}` } } : {}),
          }],
        }),
      });

      if (response.ok) return 0;
      if (response.status === 429) return this.retryDelay(response);
      if (response.status >= 500 || response.status === 408) return this.nextBackoff();
      // Permanent 4xx: discard this entry instead of poisoning the queue.
      return 0;
    } catch {
      return this.nextBackoff();
    }
  }

  private retryDelay(response: Response): number {
    const header = response.headers.get('retry-after') ?? response.headers.get('x-ratelimit-reset-after');
    const seconds = header ? Number(header) : Number.NaN;
    return Number.isFinite(seconds) && seconds > 0
      ? Math.min(seconds * 1000, this.maxBackoffMs)
      : this.nextBackoff();
  }

  private nextBackoff(): number {
    const next = this.backoffMs === 0 ? this.baseBackoffMs : this.backoffMs * 2;
    return Math.min(next, this.maxBackoffMs);
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'undefined') return 'undefined';
  try { return JSON.stringify(value) ?? String(value); } catch { return '[Unserializable]'; }
}
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
