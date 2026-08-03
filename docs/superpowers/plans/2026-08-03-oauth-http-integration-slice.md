# OAuth HTTP Integration Slice

## Goal

Verify the complete Google and GitHub browser-session lifecycle through the production NestJS controller boundary without contacting external providers.

## Changes

1. Start a real ephemeral NestJS HTTP server with the production OAuth controller and in-memory domain repositories.
2. Exercise Google authorization start, callback completion, secure session cookie issuance, session introspection, replay rejection, logout, and revoked-session rejection.
3. Exercise GitHub cross-browser state rejection before provider access, followed by successful completion from the bound browser.
4. Assert fixed-origin redirects, no-store responses, secure cookie attributes, credential-free response bodies, correlation IDs, and structured audit outcomes.

## Validation

- formatting, lint, type checking, tests, and build pass;
- AppGuardrail, Semgrep, Security Scan, and Commercial Readiness pass;
- CodeRabbit and human/security review feedback contain no unresolved actionable findings.
