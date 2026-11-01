# Security Policy

## Supported versions

Security fixes are applied to the latest maintained release. Users should upgrade to the latest release before reporting an issue against an older version.

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues, pull requests, or discussions.

Use GitHub's private vulnerability reporting for this repository:

[Report a vulnerability privately](https://github.com/abdou-da0wew/violin/security/advisories/new)

Include, where possible:

- A description of the vulnerability and its impact.
- Affected Violin versions and runtime versions.
- A minimal reproduction or proof of concept.
- Any known mitigations.

Do not include real credentials, customer data, or production secrets in the report.

## Scope and security assumptions

Violin processes application-provided values and sends log entries to configured transports. Redaction is defense in depth and is not a guarantee that all sensitive information will be detected. Applications remain responsible for minimizing sensitive log data, securing log destinations, and applying retention/access policies.

The Discord webhook transport should be configured from a secret manager or environment variable. Never commit webhook URLs or tokens.
