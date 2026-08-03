# GitHub OAuth Client Slice

## Goal

Continue issue #18 by composing the existing transaction-bound token request, bounded provider HTTP transport, token parser, fixed GitHub identity requests, and identity normalizer into one credential-safe provider boundary.

## Included

- exchange a consumed GitHub OAuth transaction only at GitHub's fixed token endpoint
- require the configured client ID, client secret, callback URI, authorization code, redirect binding, and PKCE verifier
- retrieve the GitHub user and verified-email payloads only from the allowlisted API endpoints and headers
- reject non-success, non-JSON, empty, oversized, malformed, or shape-mismatched provider responses
- preserve numeric GitHub subjects as external strings without converting large string subjects through JavaScript numbers
- select only verified email addresses, prefer the verified primary address, and fall back to the login when the display name is absent
- expose only the normalized identity profile while keeping the provider access token inside the provider boundary
- map transaction, parser, provider, and transport failures to one credential-free runtime error

## Verification

- unit tests cover fixed request sequencing and bodies, primary verified-email selection, large string subjects, missing display names, unverified email omission, malformed token/user/email responses, provider mismatch, configuration failure, and diagnostic redaction
- formatting, TypeScript compilation, the full repository test suite, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, and review feedback must pass before merge

## Follow-up

Wire the Google and GitHub provider clients into the callback application service, then atomically provision or reuse the internal identity and personal workspace before issuing the workspace-scoped browser session and fixed-origin redirect.
