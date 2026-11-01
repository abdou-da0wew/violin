import type { LogFields, RedactionOptions } from './types.js';

const SECRET_KEY_PATTERN = /(?:token|secret|password|passwd|authorization|api[_-]?key|cookie|bearer|passphrase|private[_-]?key|client[_-]?secret|access[_-]?key)/i;
const DEFAULT_CENSOR = '[REDACTED]';
const MAX_DEPTH = 12;
export const SECRET_KEY_RE = SECRET_KEY_PATTERN;

export function redactText(input: string): string {
  return input
    .replace(/\b([A-Za-z0-9_.-]*token[A-Za-z0-9_.-]*)\s*[=:]\s*["']?[^\s,"'}]{4,}/gi, '$1=[REDACTED]')
    .replace(/\b(secret|password|passwd|passphrase|api[_-]?key|client[_-]?secret|authorization|cookie|set-cookie|access[_-]?key)\s*[=:]\s*(?:Bearer\s+)?["']?[^\s,"'}]{4,}/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [REDACTED]');
}

export function redactFields(fields: LogFields, options: RedactionOptions | false = {}, serializers?: Record<string, (value: unknown) => unknown>): LogFields {
  const config = options === false ? { redactText: false } : options;
  const censor = config.censor ?? DEFAULT_CENSOR;
  const paths = new Set(config.paths ?? []);
  const seen = new WeakSet<object>();

  const visit = (value: unknown, path: string, depth: number): unknown => {
    if (typeof value === 'string') return config.redactText === false ? value : redactText(value);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`;
    if (typeof value === 'symbol') return value.toString();
    if (value === null || typeof value !== 'object') return value;
    if (depth > MAX_DEPTH) return '[MaxDepth]';
    if (seen.has(value)) return '[Circular]';
    if (value instanceof Date) {
      try { return value.toISOString(); } catch { return '[InvalidDate]'; }
    }
    if (value instanceof Error) return serializeError(value, config.redactText !== false);
    if (ArrayBuffer.isView(value)) return `[${value.constructor.name}]`;

    seen.add(value);
    if (Array.isArray(value)) {
      const result = value.map((item, index) => visit(item, `${path}.${index}`, depth + 1));
      seen.delete(value);
      return result;
    }

    const output: Record<string, unknown> = {};
    let entries: Array<[string, unknown]>;
    try { entries = Object.entries(value); } catch { return '[Unserializable]'; }
    for (const [key, original] of entries) {
      const currentPath = path ? `${path}.${key}` : key;
      const serializer = path === '' ? serializers?.[key] : undefined;
      const serializable = serializer ? safeSerialize(serializer, original) : original;
      const shouldRedact = SECRET_KEY_PATTERN.test(key) || paths.has(key) || paths.has(currentPath) || matchesPath(paths, currentPath);
      if (shouldRedact) {
        if (!config.remove) output[key] = censor;
        continue;
      }
      output[key] = visit(serializable, currentPath, depth + 1);
    }
    seen.delete(value);
    return output;
  };

  return visit(fields, '', 0) as LogFields;
}

export function serializeError(error: Error, redact = true, seen = new WeakSet<Error>()): { name: string; message: string; stack?: string; code?: string | number; cause?: unknown } {
  if (seen.has(error)) return { name: error.name || 'Error', message: '[Circular error cause]' };
  seen.add(error);
  const message = redact ? redactText(error.message) : error.message;
  const stack = error.stack ? (redact ? redactText(error.stack) : error.stack) : undefined;
  const candidate = error as Error & { code?: unknown; cause?: unknown };
  const code = typeof candidate.code === 'string' || typeof candidate.code === 'number' ? candidate.code : undefined;
  const cause = candidate.cause instanceof Error
    ? serializeError(candidate.cause, redact, seen)
    : typeof candidate.cause === 'string'
      ? (redact ? redactText(candidate.cause) : candidate.cause)
      : candidate.cause === undefined ? undefined : '[NonErrorCause]';
  return { name: error.name || 'Error', message, ...(stack ? { stack } : {}), ...(code !== undefined ? { code } : {}), ...(cause !== undefined ? { cause } : {}) };
}

function safeSerialize(serializer: (value: unknown) => unknown, value: unknown): unknown {
  try { return serializer(value); } catch { return '[SerializerError]'; }
}
function matchesPath(paths: Set<string>, currentPath: string): boolean {
  for (const candidate of paths) {
    if (!candidate.includes('*')) continue;
    const pattern = candidate.split('.').map(part => part === '*' ? '[^.]+': escapeRegExp(part)).join('\\.');
    if (new RegExp(`^${pattern}$`).test(currentPath)) return true;
  }
  return false;
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
