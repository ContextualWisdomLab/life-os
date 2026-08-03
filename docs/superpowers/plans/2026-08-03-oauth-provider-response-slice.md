# OAuth Provider Response Validation Slice

**Goal:** Validate provider token and identity responses before they can provision an internal account or session.

## Tasks

- [x] Parse only successful JSON token responses with bounded body size.
- [x] Require bearer access tokens and provider-specific Google fields.
- [x] Return generic provider-response failures without echoing secrets or upstream bodies.
- [x] Validate Google issuer, audience, expiry, issued-at time, and nonce after signature verification.
- [x] Require `azp` when a Google token has multiple audiences.
- [x] Build fixed GitHub identity endpoints with bearer credentials only in headers.
- [x] Normalize GitHub numeric IDs as external string subjects rather than internal identifiers.
- [x] Select only verified GitHub email addresses, preferring the primary address.
- [ ] Run CI, SAST, Security Scan, and review feedback; fix all actionable findings.

## Security boundary

This slice does not decode or cryptographically verify a Google ID token. `validateVerifiedGoogleIdentity` accepts claims only through a `SignatureVerifiedGoogleToken` contract. A production adapter must verify the JWT signature and algorithm against Google's current discovery/JWKS metadata before constructing that value. Raw provider access tokens and ID tokens remain ephemeral credentials and must not be persisted or logged.

GitHub access tokens are carried only in `Authorization` headers to fixed `https://api.github.com` endpoints. The authenticated `/user` response is re-read for every sign-in, and only verified email records from `/user/emails` are eligible for account metadata.

## Primary references

- Google OpenID Connect validation: `https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken`
- Google ID-token claims reference: `https://developers.google.com/identity/openid-connect/reference#id_token`
- GitHub OAuth web flow: `https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps`
- GitHub authenticated user API: `https://docs.github.com/en/rest/users/users#get-the-authenticated-user`
- GitHub authenticated email API: `https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user`
