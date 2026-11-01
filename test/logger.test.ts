import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  AppError,
  ConsoleTransport,
  DiscordTransport,
  ErrorCode,
  FileTransport,
  toAppError,
  createLogger,
  redactFields,
} from '../src/index.js';
import { createFastifyLogger } from '../src/fastify.js';
import type { LogEntry, Transport } from '../src/types.js';

class MemoryTransport implements Transport {
  entries: LogEntry[] = [];
  log(entry: LogEntry): void { this.entries.push(entry); }
}

describe('Logger', () => {
  it('filters disabled levels before evaluating mixins', () => {
    let mixinCalls = 0;
    const memory = new MemoryTransport();
    const logger = createLogger({ level: 'WARN', transports: [memory], mixin: () => { mixinCalls++; return {}; } });
    logger.debug('not emitted');
    expect(memory.entries).toHaveLength(0);
    expect(mixinCalls).toBe(0);
    logger.error('emitted');
    expect(memory.entries).toHaveLength(1);
    expect(mixinCalls).toBe(1);
  });

  it('does not let inherited bindings override new child fields', () => {
    const memory = new MemoryTransport();
    const logger = createLogger({ transports: [memory], bindings: { service: 'parent' } });
    logger.child({ service: 'child' }).info('child event');
    expect(memory.entries[0]?.bindings?.service).toBe('child');
    expect(logger.isLevelEnabled('toString')).toBe(false);
  });

  it('supports child bindings and Pino-style argument order', () => {
    const memory = new MemoryTransport();
    const logger = createLogger({ level: 'TRACE', transports: [memory], timestamp: false });
    logger.child({ service: 'api' }).info({ requestId: 'r-1' }, 'request complete');
    expect(memory.entries[0]?.bindings?.service).toBe('api');
    expect(memory.entries[0]?.fields?.requestId).toBe('r-1');
    expect(memory.entries[0]?.message).toBe('request complete');
  });

  it('accepts Error-first and message-first signatures', () => {
    const memory = new MemoryTransport();
    const logger = createLogger({ level: 'TRACE', transports: [memory] });
    const error = new TypeError('broken');
    logger.error(error, 'operation failed', { operation: 'load' });
    logger.error('another failure', error, { operation: 'save' });
    expect(memory.entries[0]?.error?.name).toBe('TypeError');
    expect(memory.entries[0]?.message).toBe('operation failed');
    expect(memory.entries[0]?.fields?.operation).toBe('load');
    expect(memory.entries[1]?.fields?.operation).toBe('save');
  });

  it('redacts secret keys and secret-like text', () => {
    const memory = new MemoryTransport();
    const logger = createLogger({ level: 'TRACE', transports: [memory] });
    logger.info('authorization=Bearer abcdefghijklmnop', { apiKey: 'secret-value', user: { name: 'Abdou' } });
    expect(memory.entries[0]?.message).not.toContain('abcdefghijklmnop');
    logger.info('authorization=privatecredentialvalue');
    expect(memory.entries[1]?.message).not.toContain('privatecredentialvalue');
    expect(memory.entries[0]?.fields?.apiKey).toBe('[REDACTED]');
  });

  it('safely serializes circular error causes and throwing getters', () => {
    const error = new Error('outer');
    Object.defineProperty(error, 'cause', { value: error });
    const result = redactFields({ error, invalid: Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('getter failed'); } }) });
    expect((result.error as Record<string, unknown>).cause).toEqual({ name: 'Error', message: '[Circular error cause]' });
    expect(result.invalid).toBe('[Unserializable]');
  });

  it('supports path redaction and circular values', () => {
    const circular: Record<string, unknown> = { keep: 'yes', session: { id: 1 } };
    circular.self = circular;
    const result = redactFields(circular, { paths: ['session.id'] });
    expect((result.session as Record<string, unknown>).id).toBe('[REDACTED]');
    expect(result.self).toBe('[Circular]');
  });

  it('does not let a failing transport break application flow', () => {
    let reported = false;
    const broken: Transport = { log() { throw new Error('sink unavailable'); } };
    const logger = createLogger({ transports: [broken], onTransportError: () => { reported = true; } });
    expect(() => logger.info('still alive')).not.toThrow();
    expect(reported).toBe(true);
  });

  it('rejects invalid sampling ratios', () => {
    expect(() => createLogger({ sampleRate: 2 })).toThrow(RangeError);
  });

  it('supports dynamic level changes and silent mode', () => {
    const memory = new MemoryTransport();
    const logger = createLogger({ transports: [memory] });
    logger.level = 'silent';
    logger.error('hidden');
    logger.level = 'DEBUG';
    logger.debug('visible');
    expect(memory.entries).toHaveLength(1);
  });

  it('keeps custom console streams usable', () => {
    let output = '';
    const sink = { isTTY: false, write(chunk: string | Uint8Array) { output += String(chunk); return true; } };
    const consoleTransport = new ConsoleTransport({ format: 'json', stdout: sink as NodeJS.WriteStream, stderr: sink as NodeJS.WriteStream });
    const logger = createLogger({ transports: [consoleTransport] });
    logger.info('console works');
    expect(output).toContain('console works');
  });
});

describe('DiscordTransport', () => {
  it('counts queued messages that cannot be delivered during shutdown', async () => {
    const transport = new DiscordTransport({
      webhookUrl: 'https://discord.invalid/api/webhooks/test',
      fetch: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
    });
    const logger = createLogger({ transports: [transport], level: 'INFO' });
    logger.error('webhook outage');
    await logger.close();
    expect(transport.getStats().queued).toBe(0);
    expect(transport.getStats().dropped).toBe(1);
  });

  it('delivers error events through an injected fetch implementation', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const transport = new DiscordTransport({
      webhookUrl: 'https://discord.invalid/api/webhooks/test',
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    const logger = createLogger({ transports: [transport], level: 'INFO' });
    logger.error('webhook delivery test', { subsystem: 'test' });
    await transport.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.allowed_mentions).toEqual({ parse: [] });
    expect(transport.getStats().queued).toBe(0);
    await logger.close();
  });
});

describe('FileTransport', () => {
  it('does not block rotation with synchronous rename calls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'violin-async-rotate-'));
    const file = new FileTransport({ directory, maxSize: 1024, maxFiles: 2, batchSize: 1 });
    const logger = createLogger({ transports: [file] });
    for (let index = 0; index < 3; index++) logger.info('rotation'.repeat(100), { index });
    await logger.close();
    const active = join(directory, `log_${new Date().toISOString().slice(0, 10)}.jsonl`);
    expect(existsSync(`${active}.1`)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it('writes structured JSONL entries and flushes on close', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'violin-'));
    const file = new FileTransport({ directory, flushIntervalMs: 60_000 });
    const logger = createLogger({ transports: [file], level: 'INFO' });
    logger.info('persisted', { jobId: 'job-1' });
    await logger.close();
    const filename = join(directory, `log_${new Date().toISOString().slice(0, 10)}.jsonl`);
    const content = await readFile(filename, 'utf8');
    const entry = JSON.parse(content.trim()) as LogEntry;
    expect(entry.message).toBe('persisted');
    expect(entry.fields?.jobId).toBe('job-1');
    await rm(directory, { recursive: true, force: true });
  });

  it('rotates when the configured file size is reached', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'violin-rotate-'));
    const file = new FileTransport({ directory, maxSize: 1024, maxFiles: 2, batchSize: 1, flushIntervalMs: 60_000 });
    const logger = createLogger({ transports: [file], level: 'INFO' });
    for (let index = 0; index < 4; index++) logger.info('x'.repeat(700), { index });
    await logger.close();
    const active = join(directory, `log_${new Date().toISOString().slice(0, 10)}.jsonl`);
    expect(existsSync(`${active}.1`)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });
});

describe('AppError', () => {
  it('normalizes unknown errors without exposing internal messages', () => {
    const privateError = new Error('database password=hunter2');
    const normalized = toAppError(privateError);
    expect(normalized.statusCode).toBe(500);
    expect(normalized.toJSON().error.message).toBe('Internal server error.');
    expect(normalized.cause).toBe(privateError);
  });

  it('supports options and legacy constructors', () => {
    const modern = new AppError(ErrorCode.NOT_FOUND_RESOURCE, 'Missing', { statusCode: 404, context: { resourceId: 'x' } });
    const legacy = new AppError(ErrorCode.INTERNAL_ERROR, 'Internal', 500, { operation: 'save' });
    expect(modern.toJSON()).toEqual({ error: { code: ErrorCode.NOT_FOUND_RESOURCE, message: 'Missing' } });
    expect(legacy.context.operation).toBe('save');
    expect(new AppError(ErrorCode.INTERNAL_ERROR, 'private').toJSON().error.message).toBe('Internal server error.');
  });
});

describe('Fastify adapter', () => {
  it('works as a Fastify loggerInstance', async () => {
    const memory = new MemoryTransport();
    const logger = createLogger({ level: 'TRACE', transports: [memory] });
    const adapter = createFastifyLogger(logger);
    adapter.info({ req: { id: 'req-1', method: 'GET', url: '/health?access_token=secretvalue', headers: { authorization: 'Bearer sensitive' }, raw: { socket: { remoteAddress: '127.0.0.1', remotePort: 3000 } } } }, 'incoming request');
    const fastifyRequestLog = memory.entries.find(entry => entry.message === 'incoming request');
    const requestFields = fastifyRequestLog?.fields?.req as Record<string, unknown> | undefined;
    expect(requestFields).toBeDefined();
    expect(requestFields).not.toHaveProperty('headers');
    expect(requestFields?.method).toBe('GET');
    expect(requestFields?.remoteAddress).toBe('127.0.0.1');
    expect(String(requestFields?.url)).toBe('/health');
    const app = Fastify({ loggerInstance: adapter });
    app.get('/health', async (_request, reply) => reply.send({ ok: true }));
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    logger.info('manual event');
    expect(memory.entries.some(entry => entry.message === 'manual event')).toBe(true);
    await app.close();
    await logger.close();
  });
});
