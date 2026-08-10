# Plugin installation authority standards note

Status: Partial

## Scope

This note records the standards basis for LifeOS-owned plugin installation authority and the current durable persistence slice. The application authority from PR #151 is implemented on protected main. PR #156 adds PostgreSQL-backed installation evidence and proves database constraints plus persistence across independent PostgreSQL client processes; it does not yet claim full application restart/recovery, plugin secret storage, outbound delivery, operator APIs, retry/dead-letter handling, or marketplace governance.

## Decisions

1. Installation, workspace, and actor identifiers remain opaque UUIDv4 values. RFC 9562 is the current IETF UUID specification and obsoletes RFC 4122. LifeOS uses UUIDv4 as an identifier format, not as an authentication secret or proof of authorization.
2. A validated plugin manifest expresses requested integration intent. It is never installation authority. The authenticated LifeOS host persists only an explicitly granted subset of the manifest's declared subscriptions, preventing plugin input from widening its own effective permissions.
3. The grant boundary applies least privilege: the host grants only capabilities necessary for the approved installation. This is consistent with NIST SP 800-53 Rev. 5 control AC-6. NIST's current Rev. 5 publication includes the Release 5.2.0 supplemental update published in August 2025; that update does not replace the Rev. 5 publication or change this repository's no-certification stance. LifeOS does not claim NIST conformance or certification.
4. Installation evidence is host-owned and credential-free. The persisted contract records plugin identity, contract version, manifest digest, explicit grants, tenant ownership, installer identity, lifecycle status, and timestamps. Plugin-provided secrets are outside this slice.
5. Revocation is an authority transition, not deletion of evidence. The host retains the bounded installation record while future active use must treat a revoked installation as ineligible.
6. Exact replay of the same installation identifier and immutable authority may be idempotent; conflicting reuse fails closed. The durable original installation timestamp wins over a later retry timestamp, so retry timing cannot rewrite historical authority evidence.
7. PostgreSQL 18 is the current major PostgreSQL line used as the primary database-semantics reference for this decision. The installation store uses a unique primary-key conflict arbiter with `INSERT ... ON CONFLICT DO NOTHING`, followed by a bounded exact winner read when needed. Under PostgreSQL's default Read Committed isolation, successive statements can observe newly committed rows, so the replay winner probe is bounded to three reads with short delays rather than treating one temporarily invisible row as durable corruption. PostgreSQL documents `ON CONFLICT` as the concurrency-aware alternative to a uniqueness error and `RETURNING` as the direct mechanism for obtaining modified-row evidence. LifeOS still validates every returned row because database success is not by itself application-authority proof.
8. Read and revocation persistence is scoped by installation UUIDv4, workspace UUIDv4, and installer-user UUIDv4. Revocation additionally requires current `active` lifecycle state and a non-retroactive timestamp condition. A zero-row transition is not success; only an exact already-revoked row inside the same workspace-and-installer authority may satisfy replay.
9. The database migration uses descriptive multiword `snake_case` schema, table, column, and explicit index names and contains no plaintext secret/token/credential column. Future secret persistence must use a separately reviewed encrypted secret-handle/KMS contract.

## Acceptance evidence

Protected main already preserves RED-to-GREEN tests for explicit-grant narrowing, unauthorized-grant rejection, exact application replay, conflicting identifier reuse, tenant isolation, revocation, malformed UUIDv4 inputs, and immutable returned evidence from PR #151.

PR #156 must additionally prove the migration naming contract; real PostgreSQL rejection of impossible lifecycle, malformed digest, and excessive-capability rows; persistence across independent PostgreSQL client processes; parameterized create/read/revoke SQL; workspace-and-installer scoping at the application and persistence boundaries; bounded conflict-winner visibility retries; preservation of the original installation timestamp across a later retry; rejection of malformed input before SQL; rejection of duplicate/corrupt rows; and absence of plaintext credential columns. Full application restart/recovery remains outside this slice until runtime composition exists. Exact-head CI, security, coverage, and current review findings must pass before merge. Protected main remains the shipped source of truth.

## APA 7 references

Davis, K. R., Peabody, B. G., & Leach, P. J. (2024). *Universally Unique IDentifiers (UUIDs) (RFC 9562).* RFC Editor. https://doi.org/10.17487/RFC9562

Publication status: Published IETF Standards Track RFC (Proposed Standard), May 2024.

Joint Task Force. (2020). *Security and privacy controls for information systems and organizations (NIST Special Publication 800-53 Rev. 5).* National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-53r5

Publication status: Final NIST Special Publication; current Rev. 5 supplemental control release is 5.2.0 (August 27, 2025).

PostgreSQL Global Development Group. (2025). *PostgreSQL 18 documentation: INSERT.* https://www.postgresql.org/docs/18/sql-insert.html

Publication status: Published PostgreSQL 18 release documentation.

PostgreSQL Global Development Group. (2025). *PostgreSQL 18 documentation: Returning data from modified rows.* https://www.postgresql.org/docs/18/dml-returning.html

Publication status: Published PostgreSQL 18 release documentation.

PostgreSQL Global Development Group. (2025). *PostgreSQL 18 documentation: Transaction isolation.* https://www.postgresql.org/docs/18/transaction-iso.html

Publication status: Published PostgreSQL 18 release documentation.
