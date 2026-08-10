# Plugin installation authority standards note

Status: Partial

## Scope

This note records the standards basis for LifeOS-owned plugin installation authority and the current durable persistence slice. The application authority from PR #151 is implemented on protected main. PR #156 adds restart-safe PostgreSQL installation evidence, but does not claim that LifeOS has completed plugin secret storage, outbound delivery, operator APIs, retry/dead-letter handling, or marketplace governance.

## Decisions

1. Installation, workspace, and actor identifiers remain opaque UUIDv4 values. RFC 9562 is the current IETF UUID specification and obsoletes RFC 4122. LifeOS uses UUIDv4 as an identifier format, not as an authentication secret or proof of authorization.
2. A validated plugin manifest expresses requested integration intent. It is never installation authority. The authenticated LifeOS host persists only an explicitly granted subset of the manifest's declared subscriptions, preventing plugin input from widening its own effective permissions.
3. The grant boundary applies least privilege: the host grants only capabilities necessary for the approved installation. This is consistent with NIST SP 800-53 Rev. 5 control AC-6. This repository does not claim NIST conformance or certification.
4. Installation evidence is host-owned and credential-free. The persisted contract records plugin identity, contract version, manifest digest, explicit grants, tenant ownership, installer identity, lifecycle status, and timestamps. Plugin-provided secrets are outside this slice.
5. Revocation is an authority transition, not deletion of evidence. The host retains the bounded installation record while future active use must treat a revoked installation as ineligible.
6. Exact replay of the same installation identifier and immutable authority may be idempotent; conflicting reuse fails closed. The durable original installation timestamp wins over a later retry timestamp, so retry timing cannot rewrite historical authority evidence.
7. PostgreSQL 18 is the current major PostgreSQL line used as the primary database-semantics reference for this decision. The installation store uses a unique primary-key conflict arbiter with `INSERT ... ON CONFLICT DO NOTHING`, followed by a bounded exact winner read when needed. PostgreSQL documents `ON CONFLICT` as the concurrency-aware alternative to a uniqueness error and `RETURNING` as the direct mechanism for obtaining modified-row evidence. LifeOS still validates every returned row because database success is not by itself application-authority proof.
8. Revocation uses one conditional `UPDATE ... RETURNING` scoped by installation UUIDv4, workspace UUIDv4, current `active` lifecycle state, and a non-retroactive timestamp condition. A zero-row transition is not success; only an exact already-revoked workspace-owned row may satisfy replay.
9. The database migration uses descriptive multiword `snake_case` schema, table, column, and explicit index names and contains no plaintext secret/token/credential column. Future secret persistence must use a separately reviewed encrypted secret-handle/KMS contract.

## Acceptance evidence

Protected main already preserves RED-to-GREEN tests for explicit-grant narrowing, unauthorized-grant rejection, exact application replay, conflicting identifier reuse, tenant isolation, revocation, malformed UUIDv4 inputs, and immutable returned evidence from PR #151.

PR #156 must additionally prove the migration naming/constraint contract, parameterized create/read/revoke SQL, durable replay after process restart semantics, preservation of the original installation timestamp across a later retry, rejection of malformed input before SQL, rejection of duplicate/corrupt rows, and absence of plaintext credential columns. Exact-head CI, security, coverage, and current review findings must pass before merge. Protected main remains the shipped source of truth.

## APA 7 references

Davis, K. R., Peabody, B. G., & Leach, P. J. (2024). *Universally Unique IDentifiers (UUIDs) (RFC 9562).* RFC Editor. https://doi.org/10.17487/RFC9562

Joint Task Force. (2020). *Security and privacy controls for information systems and organizations (NIST Special Publication 800-53 Rev. 5).* National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-53r5

PostgreSQL Global Development Group. (2025). *PostgreSQL 18 documentation: INSERT.* https://www.postgresql.org/docs/18/sql-insert.html

PostgreSQL Global Development Group. (2025). *PostgreSQL 18 documentation: Returning data from modified rows.* https://www.postgresql.org/docs/18/dml-returning.html
