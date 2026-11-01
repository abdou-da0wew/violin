import { LEVEL_SEVERITY, LOG_LEVELS, type LogLevel, type LoggerLevel } from './types.js';

export const DEFAULT_LOG_LEVEL: LogLevel = 'INFO';
export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value.toUpperCase());
}
export function normalizeLevel(value: string | undefined, fallback: LoggerLevel = DEFAULT_LOG_LEVEL): LoggerLevel {
  if (!value) return fallback;
  const normalized = value.toLowerCase() === 'silent' ? 'silent' : value.toUpperCase();
  return normalized === 'silent' || isLogLevel(normalized) ? normalized : fallback;
}
export function severityOf(level: LoggerLevel): number {
  return level === 'silent' ? Number.POSITIVE_INFINITY : LEVEL_SEVERITY[level as LogLevel];
}
export function isAtLeast(level: LogLevel, threshold: LoggerLevel): boolean {
  return LEVEL_SEVERITY[level] >= severityOf(threshold);
}
