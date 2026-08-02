# Identity and Personal Workspace Slice

**Goal:** Establish the provider-neutral identity domain used by future Google and GitHub OAuth callbacks.

## Tasks

- [x] Define internal User, ExternalIdentity, and Workspace entities.
- [x] Use opaque UUIDv4 strings for all internal identifiers.
- [x] Keep provider subjects as external attributes rather than internal primary keys.
- [x] Provision exactly one personal workspace on first sign-in.
- [x] Make repeated sign-in idempotent for the same provider identity.
- [x] Add PostgreSQL constraints for provider identity uniqueness and one personal workspace per owner.
- [ ] Add OAuth state, PKCE, callback verification, and secure session issuance in the next slice.
- [ ] Run CI, SAST, Security Scan, and review feedback; fix all actionable findings.
