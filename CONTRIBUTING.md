# Contributing to Violin

Thank you for considering a contribution. This guide describes the expected workflow and quality bar.

## Before opening an issue

- Search existing issues and discussions for the same problem.
- For bugs, include runtime versions and a minimal reproduction.
- Never include API keys, webhook URLs, credentials, private logs, or user data.
- Use the private vulnerability reporting process in [SECURITY.md](SECURITY.md) for security issues.

## Development setup

Requirements:

- Bun 1.4 or newer.
- Node.js 20 or newer for package compatibility checks.
- Git.

```bash
git clone https://github.com/abdou-da0wew/violin.git
cd violin
bun install --frozen-lockfile
```

## Local checks

Run all checks before opening a pull request:

```bash
bun run typecheck
bun test
bun run build
npm pack --dry-run
```

Add tests for behavior changes. For transport changes, cover the success path, failure path, and queue/lifecycle behavior. For security-sensitive changes, add tests that demonstrate both the redacted and allowed data paths.

## Code expectations

- Keep the logger's synchronous hot path small and predictable.
- Do not perform filesystem or network I/O directly inside `Transport.log()`.
- Keep queues bounded when a transport performs asynchronous delivery.
- Do not let logging failures crash the application that emitted the log.
- Preserve ESM, CommonJS, and generated declaration compatibility.
- Avoid adding required runtime dependencies without a clear reason.
- Keep public types explicit and maintain strict TypeScript checks.
- Document configuration options, lifecycle behavior, and compatibility limits.
- Never weaken redaction silently or expose unknown errors to client responses.

## Pull requests

1. Create a focused branch from `main`.
2. Make the smallest coherent change that solves the problem.
3. Add or update tests and docs.
4. Run the full local checks.
5. Explain the behavior change, tests, and compatibility impact in the pull request.
6. Link related issues where applicable.

Public API and behavior changes should be discussed before merging. Breaking changes require a clear migration note and a version bump consistent with semantic versioning.

## Commit messages

Use concise imperative messages. Conventional prefixes are welcome, for example `feat: add syslog transport`, `fix: serialize circular causes`, or `docs: clarify Fastify adapter limits`.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).
