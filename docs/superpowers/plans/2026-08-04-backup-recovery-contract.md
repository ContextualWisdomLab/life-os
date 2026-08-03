# Backup and recovery contract slice

## Outcome

Operators can create a private, verifiable PostgreSQL logical backup and restore it into a deliberately empty database through a rehearsed, measurable, non-destructive procedure.

## Primary references

- PostgreSQL backup and restore overview: <https://www.postgresql.org/docs/current/backup.html>
- `pg_dump`: <https://www.postgresql.org/docs/current/app-pgdump.html>
- `pg_restore`: <https://www.postgresql.org/docs/current/app-pgrestore.html>
- PostgreSQL continuous archiving and point-in-time recovery: <https://www.postgresql.org/docs/current/continuous-archiving.html>
- NIST SP 800-34 Rev. 1 contingency planning guidance: <https://doi.org/10.6028/NIST.SP.800-34r1>

PostgreSQL distinguishes SQL dumps from file-system backups and continuous archiving. This slice deliberately establishes the logical-dump tier and does not represent periodic dumps as point-in-time recovery. NIST contingency guidance emphasizes recovery requirements, procedures, testing, exercises, and maintenance; the repository therefore requires an executable restore rehearsal rather than documentation-only claims.

## Included capability

- create a PostgreSQL custom-format archive with source ownership and privileges excluded;
- write into a private temporary directory and publish only after archive listing succeeds;
- emit a SHA-256 manifest and bounded non-secret metadata beside the archive;
- apply private directory and artifact permissions;
- refuse backup-directory symlinks and filename collisions;
- verify checksum and archive readability before restoration;
- reject PostgreSQL maintenance databases and any target containing user relations;
- require an explicit restore confirmation phrase;
- restore in one transaction with immediate failure on SQL errors;
- emit a credential-free measured restore duration;
- run a real Linux CI rehearsal through pinned PostgreSQL client tools;
- verify exact tenant records, non-empty-target refusal, checksum-corruption refusal, and no partial restore;
- document initial RPO, RTO, storage controls, rehearsal steps, failure handling, and production extensions.

## Capability boundary

This slice does not schedule backups, upload them to object storage, encrypt archive bytes itself, rotate retention, archive WAL, provide point-in-time recovery, back up NATS JetStream state, automate application cutover, or restore over an existing database. Those remain deployment-specific production extensions and must not be inferred from a passing logical-restore contract.

## Security properties

- Database credentials are accepted only through environment variables and are not written to output or metadata.
- Archive paths are operator-selected but the root directory is rejected and a directory symlink is refused.
- Temporary artifacts remain under a mode-`0700` directory and final artifacts are mode `0600`.
- Restore requires an adjacent checksum whose archive basename matches the captured manifest.
- Restore has no destructive override for a non-empty target.
- Source ownership and ACLs are not replayed into the target.
- The restore is single-transaction, preventing a partially applied logical archive after a statement failure.
- CI uses synthetic isolated databases and pinned PostgreSQL client image bytes.

## Validation gate

Merge only when the real restore rehearsal, formatting, lint, type checking, tests, build, Compose validation, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all human/security review feedback pass on the exact current head with no unresolved actionable finding.

## Rollback

The change is additive and does not alter production database state automatically. Roll back by reverting the scripts, contract package, workspace registration, and documentation. Never delete backup artifacts merely because the implementation is rolled back; retain or expire them under the deployment's approved retention policy.

Refs #21.
