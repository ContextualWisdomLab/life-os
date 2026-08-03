# OAuth Provider HTTP Client Slice

## Goal

Add the fail-closed outbound HTTP boundary required by issue #18 before provider callback orchestration is allowed to contact Google or GitHub.

## Included

- exact HTTPS endpoint and method allowlists for Google token exchange, Google JWKS retrieval, GitHub token exchange, and GitHub user and verified-email retrieval
- endpoint-specific request-header allowlists that prevent ambient cookies, host overrides, and unrelated credentials from being forwarded
- request-body size limits and rejection of bodies on fixed GET endpoints
- redirect refusal, bounded request deadlines, abort propagation, bounded streamed response bodies, strict UTF-8 decoding, and JSON content-type enforcement
- generic credential-free failures that never include authorization codes, client credentials, provider tokens, response bodies, or target URLs
- compatibility coverage for the existing token-exchange and GitHub identity request builders

## Verification

- unit tests cover exact endpoint execution, ambient credential rejection, query-bearing and unapproved destinations, unexpected GET bodies, redirects, non-JSON responses, oversized streams, timeout aborts, and failure redaction
- TypeScript compilation and the full repository test suite remain required
- CI, SAST Semgrep, Security Scan, AppGuardrail, Commercial Readiness, and review feedback must pass before merge

## Follow-up

The next slice should add Google JWKS retrieval and signature verification, then compose token exchange, provider identity retrieval, atomic account provisioning, session issuance, audit events, and fixed post-login redirects into the two callback controllers.
