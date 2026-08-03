# OAuth Authorization-Code Exchange Slice

**Goal:** Build provider-specific authorization-code exchange requests without performing network calls or exposing credentials in URLs.

## Tasks

- [x] Build Google token requests for the authorization-code grant with PKCE.
- [x] Build GitHub access-token requests with PKCE and JSON response negotiation.
- [x] Keep client secrets and authorization codes in form-encoded POST bodies.
- [x] Reuse strict redirect URI validation from authorization request construction.
- [x] Reject provider mismatches and incomplete credentials before network execution.
- [x] Run CI, SAST, Security Scan, and review feedback; fix all actionable findings.

## Provider references

- Google OpenID Connect discovery and token endpoint: `https://developers.google.com/identity/openid-connect/reference`
- GitHub OAuth access-token exchange: `https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps`

## Deliberate boundary

This slice creates deterministic request descriptions only. HTTP execution, timeout and retry policy, provider response parsing, access-token redaction, Google ID-token validation, and GitHub profile retrieval remain separate adapters.
