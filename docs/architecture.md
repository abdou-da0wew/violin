# Architecture

Violin separates the application-facing logger from output destinations. That boundary lets a project change its logging sinks without rewriting the code that emits events.

## Pipeline

```text
Application call
      |
      v
Global level check ---- disabled ----> return
      |
      v
Argument normalization
      |
      v
Mixin and structured fields
      |
      v
Serializers and redaction
      |
      v
Normalized LogEntry
      |
      +----> Console transport
      +----> File transport ----> bounded queue ----> serialized writer
      +----> Discord transport -> bounded queue ----> sequential webhook sender
      +----> Custom transports
```

Filtering occurs before argument normalization and all avoidable per-entry work. The logger creates one normalized entry and passes it to each transport that accepts the severity. A transport exception is isolated; an optional `onTransportError` callback can observe it.

## Log entry

A `LogEntry` contains:

- `level` and numeric `severity` for filtering and indexing.
- `message` for a short human-readable event description.
- `time` as epoch milliseconds, with optional ISO `timestamp`.
- `bindings` inherited from the root logger and child loggers.
- `fields` from the individual call and configured mixin.
- `error` as normalized exception metadata when an Error instance is supplied.

The exact output layout belongs to the transport. Console can render readable text or JSON; file output serializes each entry as one JSONL record; custom transports can map it to metrics, databases, queues, or external observability platforms.

## Ownership and lifecycle

The logger owns references to its configured transports. Child loggers share those same transport instances. This avoids creating a file descriptor, timer, queue, or network worker for every request or subsystem.

Create transports once during process startup. During shutdown, call `flush()` when queued data must be drained while keeping the logger active, then `close()` to release timers and handles. `close()` is idempotent. A child logger does not have independent transport ownership; close the root logger once.

## Backpressure

File and Discord transports use bounded queues. A bounded queue makes memory usage predictable when the disk or network destination is slower than the application. When the configured queue is full, new log entries are dropped and counted. This is a deliberate trade-off: logging must not create an unbounded memory problem during an incident.

The transports expose `getStats()` for queue depth, dropped counts, and relevant failure state. Production applications should monitor those values when log delivery is operationally important.

## Package layout

```text
src/
  logger.ts              Logger API, argument parsing, pipeline
  levels.ts              Severity mapping and level normalization
  redaction.ts           Error normalization and secret redaction
  types.ts               Public interfaces and configuration types
  fastify.ts             Fastify loggerInstance adapter
  errors/
    app-error.ts         AppError and unknown-error normalization
    error-code.ts        Stable default error vocabulary
  transports/
    console.ts           Human-readable and JSON console output
    file.ts              Buffered JSONL output and rotation
    discord.ts           Bounded Discord webhook transport
```

## Runtime boundary

The core package uses Node.js built-in APIs and no required runtime dependency. Fastify is imported as a type by the adapter and remains an optional peer dependency for the application that uses that subpath. Build output includes ESM and CommonJS entry points with declaration files.

## Design constraints

- A transport's `log()` method is synchronous and should be non-blocking.
- Network and filesystem work belongs in transport-owned queues.
- Unknown application errors should not expose internal messages in client responses.
- A log sink failure should not break the business operation being logged.
- Automatic optimizations must not silently change data semantics; sampling is explicit and configurable.
