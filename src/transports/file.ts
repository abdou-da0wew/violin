import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isAtLeast, normalizeLevel } from '../levels.js';
import type { FileTransportOptions, LogEntry, LogLevel, LoggerLevel, Transport } from '../types.js';

const DEFAULT_MAX_SIZE = 20 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_QUEUE_SIZE = 10_000;
const DEFAULT_BATCH_SIZE = 256;

/**
 * Bounded, batched JSONL file transport. Disk writes and rotation never happen
 * in Logger.log(); a single drain loop serializes writes and rotation.
 */
export class FileTransport implements Transport {
  readonly name = 'file';
  private readonly directory: string;
  private readonly minLevel: LoggerLevel;
  private readonly maxSize: number;
  private readonly maxFiles: number;
  private readonly maxQueueSize: number;
  private readonly batchSize: number;
  private readonly queue: string[] = [];
  private queueHead = 0;
  private stream: WriteStream | null = null;
  private currentDate = '';
  private currentPath = '';
  private bytesWritten = 0;
  private sizePromise: Promise<void> = Promise.resolve();
  private pumpPromise: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private dropped = 0;
  private closed = false;
  private lastError: unknown;

  constructor(options: FileTransportOptions) {
    this.directory = options.directory;
    this.minLevel = normalizeLevel(options.level, 'TRACE');
    this.maxSize = Math.max(1024, options.maxSize ?? DEFAULT_MAX_SIZE);
    this.maxFiles = Math.max(1, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES));
    this.maxQueueSize = Math.max(1, Math.floor(options.maxQueueSize ?? DEFAULT_QUEUE_SIZE));
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE));
    mkdirSync(this.directory, { recursive: true });
    this.openForDate(today());

    const interval = Math.max(25, options.flushIntervalMs ?? 250);
    this.timer = setInterval(() => this.schedulePump(), interval);
    this.timer.unref();
  }

  supports(level: LogLevel): boolean { return isAtLeast(level, this.minLevel); }

  log(entry: LogEntry): void {
    if (this.closed) return;
    const pending = this.queue.length - this.queueHead;
    if (pending >= this.maxQueueSize) {
      this.dropped++;
      return;
    }

    try {
      this.queue.push(`${JSON.stringify(entry)}\n`);
      this.compactQueue();
      if (pending === 0) this.schedulePump();
    } catch (error) {
      this.lastError = error;
      this.dropped++;
    }
  }

  getStats(): { queued: number; dropped: number; bytesWritten: number; lastError: unknown } {
    return {
      queued: this.queue.length - this.queueHead,
      dropped: this.dropped,
      bytesWritten: this.bytesWritten,
      lastError: this.lastError,
    };
  }

  async flush(): Promise<void> {
    while (this.queueHead < this.queue.length || this.pumpPromise) {
      if (!this.pumpPromise) this.schedulePump();
      await this.pumpPromise;
    }
    await this.streamReady();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    await this.endStream();
  }

  private schedulePump(): void {
    if (this.pumpPromise || this.closed && this.queueHead >= this.queue.length) return;
    this.pumpPromise = this.pumpQueue().catch(error => {
      this.lastError = error;
    }).finally(() => {
      this.pumpPromise = null;
      if (this.queueHead < this.queue.length && !this.closed) this.schedulePump();
    });
  }

  private async pumpQueue(): Promise<void> {
    while (this.queueHead < this.queue.length) {
      const end = Math.min(this.queueHead + this.batchSize, this.queue.length);
      const batch = this.queue.slice(this.queueHead, end);
      this.queueHead = end;
      if (this.queueHead === this.queue.length) {
        this.queue.length = 0;
        this.queueHead = 0;
      }

      try {
        await this.writeBatch(batch.join(''));
      } catch (error) {
        this.lastError = error;
        this.dropped += batch.length;
      }
    }
  }

  private async writeBatch(payload: string): Promise<void> {
    const size = Buffer.byteLength(payload);
    const date = today();
    if (date !== this.currentDate) await this.openForDateAsync(date);
    await this.sizePromise;
    if (this.bytesWritten > 0 && this.bytesWritten + size > this.maxSize) await this.rotate();
    if (!this.stream) this.openForDate(date);
    const stream = this.stream;
    if (!stream) throw new Error('File transport has no writable stream');

    await new Promise<void>((resolve, reject) => {
      stream.write(payload, error => error ? reject(error) : resolve());
    });
    this.bytesWritten += size;
  }

  private openForDate(date: string): void {
    this.currentDate = date;
    this.currentPath = join(this.directory, `log_${date}.jsonl`);
    this.bytesWritten = 0;
    const targetPath = this.currentPath;
    this.sizePromise = stat(targetPath).then(stats => {
      if (this.currentPath === targetPath) this.bytesWritten = stats.size;
    }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.lastError = error;
    });
    this.stream = createWriteStream(this.currentPath, { flags: 'a', highWaterMark: 1024 * 1024 });
    this.stream.on('error', error => { this.lastError = error; });
  }

  private async openForDateAsync(date: string): Promise<void> {
    await this.endStream();
    this.openForDate(date);
    await this.sizePromise;
  }

  private async rotate(): Promise<void> {
    const previous = this.currentPath;
    await this.endStream();

    for (let index = this.maxFiles - 1; index >= 1; index--) {
      const from = `${previous}.${index}`;
      const to = `${previous}.${index + 1}`;
      try {
        await rm(to, { force: true });
        await rename(from, to);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.lastError = error;
      }
    }

    try {
      await rm(`${previous}.1`, { force: true });
      await rename(previous, `${previous}.1`);
    } catch (error) {
      this.lastError = error;
    }

    this.openForDate(today());
    await this.sizePromise;
  }

  private async endStream(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    if (!stream || stream.closed) return;
    await new Promise<void>(resolve => {
      stream.end(() => resolve());
      stream.once('error', () => resolve());
    });
  }

  private async streamReady(): Promise<void> {
    if (!this.stream) return;
    if (this.stream.writableLength === 0) return;
    await new Promise<void>(resolve => this.stream?.once('drain', () => resolve()) ?? resolve());
  }

  private compactQueue(): void {
    if (this.queueHead > 1024 && this.queueHead * 2 > this.queue.length) {
      this.queue.splice(0, this.queueHead);
      this.queueHead = 0;
    }
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
