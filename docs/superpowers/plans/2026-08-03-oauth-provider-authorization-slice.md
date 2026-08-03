# OAuth Provider Authorization Slice

**Goal:** Build standards-aligned Google and GitHub authorization requests on top of the single-use OAuth transaction primitives.

## Tasks

- [x] Add a Google OIDC nonce to Google transactions and return it on transaction consumption.
- [x] Build Google authorization-code URLs with `openid email profile`, state, nonce, and PKCE S256.
- [x] Build GitHub authorization URLs with minimum identity scopes, state, and PKCE S256.
- [x] Require HTTPS redirect URIs except for explicit loopback development hosts.
- [x] Reject provider/transaction mismatches and malformed client configuration.
- [x] Verify authorization URLs never contain client secrets.
- [ ] Run CI, SAST, Security Scan, and review feedback; fix all actionable findings.

## Provider references

- Google OpenID Connect discovery and authorization endpoint: `https://developers.google.com/identity/openid-connect/reference`
- GitHub OAuth web application flow and PKCE parameters: `https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps`

## Deliberate boundary

Authorization-code exchange, Google ID-token signature and claim validation, GitHub profile retrieval, secure cookie issuance, and durable repository adapters remain in the following slices.
