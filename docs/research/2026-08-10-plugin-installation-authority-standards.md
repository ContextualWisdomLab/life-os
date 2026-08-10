# Plugin installation authority standards note

Status: Implemented on active PR

## Scope

This note records the standards basis for the first host-owned plugin installation authority slice. It does not claim that LifeOS has completed durable plugin persistence, secret storage, outbound delivery, operator APIs, or marketplace governance.

## Decisions

1. Installation, workspace, and actor identifiers remain opaque UUIDv4 values. RFC 9562 is the current IETF UUID specification and obsoletes RFC 4122. LifeOS uses UUIDv4 as an identifier format, not as an authentication secret or proof of authorization.
2. A validated plugin manifest expresses requested integration intent. It is never installation authority. The authenticated LifeOS host persists only an explicitly granted subset of the manifest's declared subscriptions, preventing plugin input from widening its own effective permissions.
3. The grant boundary applies least privilege: the host grants only capabilities necessary for the approved installation. This is consistent with NIST SP 800-53 Rev. 5 control AC-6. NIST's current Rev. 5 catalog includes the Release 5.2.0 updates published in 2025; this slice does not claim NIST conformance or certification.
4. Installation evidence is host-owned and credential-free. The persisted contract records plugin identity, contract version, manifest digest, explicit grants, tenant ownership, installer identity, lifecycle status, and timestamps. Plugin-provided secrets are outside this slice.
5. Revocation is an authority transition, not deletion of evidence. The host retains the bounded installation record while future active use must treat a revoked installation as ineligible.
6. Exact replay of the same installation identifier and authority may be idempotent; conflicting reuse fails closed. Cross-workspace lookup does not disclose another tenant's installation record.

## Acceptance evidence

The active PR must preserve RED-to-GREEN tests for explicit-grant narrowing, unauthorized-grant rejection, exact replay, conflicting identifier reuse, tenant isolation, revocation, malformed UUIDv4 inputs, and immutable returned evidence. Exact-head CI, security, coverage, and current review findings must pass before merge. Protected main remains the shipped source of truth.

## APA 7 references

Davis, K. R., Peabody, B. G., & Leach, P. J. (2024). *Universally Unique IDentifiers (UUIDs) (RFC 9562).* RFC Editor. https://doi.org/10.17487/RFC9562

Joint Task Force. (2020). *Security and privacy controls for information systems and organizations (NIST Special Publication 800-53 Rev. 5).* National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-53r5
