# Google OIDC Verifier Slice

## Goal

Add the fixed-endpoint, fail-closed provider boundary needed before a Google OAuth callback may provision an account or issue a LifeOS session.

## Included

- authorization-code exchange at Google's fixed token endpoint
- mandatory PKCE verifier submission using the stored transaction value
- strict redirect suppression, request timeout, response-size bounds, and generic upstream failures
- local RS256 verification against Google's fixed JWKS endpoint
- bounded JWKS caching with a forced refresh when an unknown key ID appears
- issuer, audience, authorized-presenter, expiration, issued-at, not-before, nonce, subject, and claim-type validation
- constant-time nonce comparison
- access and refresh token discard at the provider boundary
- regression coverage for key rotation, algorithm confusion, signature forgery, malformed claims, malformed key sets, response limits, and error redaction

## Security decisions

The implementation does not consume OpenID discovery metadata at runtime, accept caller-selected endpoints, follow redirects, call the debugging token-info endpoint, or return provider bearer tokens. Google keys are accepted only as RSA signing keys and ID tokens only under RS256. A callback must present the nonce and PKCE verifier recovered from the single-use server-side OAuth transaction.

## Authoritative references

- Google OpenID Connect reference: https://developers.google.com/identity/openid-connect/reference
- Google server-side ID-token verification guide: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Google OAuth web-server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- RFC 7636, Proof Key for Code Exchange: https://www.rfc-editor.org/rfc/rfc7636
- RFC 7517, JSON Web Key: https://www.rfc-editor.org/rfc/rfc7517

## Follow-up

The next slice should connect this verifier to a fixed Google callback controller, consume the one-time OAuth transaction, provision the PostgreSQL-backed external identity and personal workspace, issue a server-backed LifeOS session cookie, clear the OAuth browser cookie, and redirect to the fixed post-login route.
