# PostgreSQL backup and restore runbook

## Purpose and scope

This runbook defines the minimum recoverability contract for the LifeOS PostgreSQL database. It covers a portable logical backup, checksum verification, and restoration into a deliberately empty database. It does not claim point-in-time recovery, automatic failover, cross-region replication, or backup-object encryption by itself.

PostgreSQL documents SQL dumps, file-system backups, and continuous archiving as distinct backup approaches. This first slice uses a custom-format SQL dump because it is portable, inspectable with `pg_restore`, and appropriate for rehearsing a full logical restore. Production deployments that require a smaller recovery-point objective must add WAL archiving and point-in-time recovery rather than treating periodic dumps as equivalent. See:

- <https://www.postgresql.org/docs/current/backup.html>
- <https://www.postgresql.org/docs/current/app-pgdump.html>
- <https://www.postgresql.org/docs/current/app-pgrestore.html>
- <https://www.postgresql.org/docs/current/continuous-archiving.html>
- NIST SP 800-34 Rev. 1: <https://doi.org/10.6028/NIST.SP.800-34r1>

## Recovery objectives

The repository-level contract uses these initial targets:

| Measure | Initial target | Evidence |
| --- | ---: | --- |
| Backup success | Every scheduled run exits zero and emits an archive, checksum, and metadata file | backup job logs and object inventory |
| Restore success | 100% of scheduled recovery rehearsals restore known tenant records into an empty database | `infra/tests/restore.spec.ts` and rehearsal records |
| Recovery point objective | 24 hours for the logical-dump tier | timestamp of newest independently stored verified archive |
| Recovery time objective | 60 minutes for a database that fits the tested logical-restore envelope | measured `restore_duration_seconds` plus application validation |
| Rehearsal frequency | At least monthly and after PostgreSQL major-version or restore-procedure changes | dated rehearsal record approved by an operator |

These are minimum targets, not universal service guarantees. A deployment owner must set stricter objectives from its business impact analysis, data volume, customer commitments, and hosting topology.

## Security and storage requirements

1. Supply `DATABASE_URL` through the deployment secret manager. Never place it in command history, source control, backup filenames, metadata, or logs.
2. Write backups to a dedicated operator-controlled directory. `backup.sh` rejects a directory symlink, applies mode `0700` to the selected directory, and publishes archive artifacts with mode `0600`.
3. Copy the completed archive, checksum, and metadata as one set to storage independent of the primary database host. Use provider-side encryption, access logging, immutability or object lock where available, lifecycle retention, and a separate administrative trust boundary.
4. Do not expose the backup directory through an application container, static-file server, shared developer volume, or general-purpose CI artifact with broad read access.
5. Treat backups as production personal data. Apply the same or stronger tenant isolation, legal hold, deletion, residency, incident response, and access-review controls as the primary database.
6. Do not use the restore command against `postgres`, `template0`, or `template1`. The script also refuses a target containing user relations and has no override for in-place destructive restoration.

## Create a logical backup

Prerequisites:

- Bash
- PostgreSQL client tools compatible with the server (`pg_dump` and `pg_restore`)
- `sha256sum`
- access to a trusted destination with enough capacity for the temporary and final archive

Run:

```bash
export DATABASE_URL='postgresql://...'
export BACKUP_DIRECTORY='/srv/life-os/backups'
bash infra/backup/backup.sh
```

Successful output contains only paths to:

```text
backup_archive=/srv/life-os/backups/life-os-backup-<UTC timestamp>.dump
backup_checksum=/srv/life-os/backups/life-os-backup-<UTC timestamp>.dump.sha256
backup_metadata=/srv/life-os/backups/life-os-backup-<UTC timestamp>.dump.metadata
```

The command writes into a private temporary directory, verifies that `pg_restore` can list the custom archive, computes SHA-256, and atomically publishes the three files. It does not delete previous backups. Retention deletion must be implemented by the independently controlled backup store after successful replication and according to the deployment retention policy.

## Verify an archive before transport or restore

Keep the archive and its adjacent `.sha256` file together, then run from their directory:

```bash
sha256sum --check life-os-backup-<UTC timestamp>.dump.sha256
pg_restore --list life-os-backup-<UTC timestamp>.dump >/dev/null
```

A checksum proves that the bytes match the captured manifest; it does not prove confidentiality, freshness, completeness of external systems, or successful application recovery. Those properties require storage controls and a restore rehearsal.

## Restore into an empty database

Create a new empty non-system database with the required encoding and access restrictions. Confirm that no user relation exists. Then run:

```bash
export DATABASE_URL='postgresql://.../life_os_restore_target'
export BACKUP_ARCHIVE='/srv/life-os/backups/life-os-backup-<UTC timestamp>.dump'
export LIFEOS_RESTORE_CONFIRMATION='restore-empty-database'
bash infra/backup/restore.sh
```

The restore command:

- requires the adjacent checksum and verifies it before contacting the target for restoration;
- validates that the archive is readable by `pg_restore`;
- rejects protected PostgreSQL maintenance databases;
- rejects a target containing tables, partitioned tables, views, materialized views, sequences, or foreign tables;
- restores in one transaction with `--exit-on-error`, without replaying source ownership or privileges;
- emits the target database name, measured duration, and completion status without printing credentials.

The command intentionally does not drop or overwrite an existing application database. Cutover remains a separately reviewed operator action.

## Recovery rehearsal procedure

1. Record the rehearsal identifier, operator, source archive timestamp, PostgreSQL server/client versions, expected tenant fixtures, target RPO, and target RTO.
2. Provision an isolated empty database with no production ingress and no outbound notification side effects.
3. Verify checksum and archive listing.
4. Run `restore.sh` and record `restore_duration_seconds`.
5. Run service migrations only when the release procedure explicitly requires them; never silently migrate the only retained restored copy.
6. Validate schema presence, migration/version records, representative row counts, tenant boundaries, foreign keys, authentication/session invalidation expectations, and application health using synthetic or approved recovery fixtures.
7. Verify that rerunning restore against the now non-empty target is refused.
8. Destroy the rehearsal database and securely expire any temporary archive copies.
9. Record pass/fail, actual recovery point, actual recovery time, gaps, owners, and due dates. A failed rehearsal is an operational incident or release blocker according to the deployment policy.

`infra/tests/restore.spec.ts` automates the core repository rehearsal on Linux CI: it creates isolated source and target databases, captures tenant-scoped records, performs a real custom-format dump through PostgreSQL client tools, restores it, verifies exact records, confirms non-empty-target refusal, corrupts the checksum, and confirms that no relation is restored.

## Production extensions required

Before claiming production disaster recovery for a hosted multi-tenant deployment, add and validate:

- scheduled execution with alerting for missed or failed backups;
- independent encrypted immutable storage and restore-only credentials;
- a retention schedule covering operational recovery, legal obligations, and verified deletion;
- WAL archiving, base backups, and point-in-time recovery when the required RPO is below the dump interval;
- a documented application cutover, DNS/connection-pool handling, and rollback procedure;
- restore capacity tests at realistic data volume, including indexes and large objects;
- coverage for NATS JetStream state or a documented event-stream reconstruction boundary;
- regional and provider failure scenarios;
- quarterly access review and evidence of monthly restore rehearsals;
- customer-facing recovery commitments aligned with measured capability.

## Failure handling

Never replace the most recent known-good archive after a failed backup. Preserve logs that exclude secrets, quarantine incomplete temporary artifacts, alert the operator, and retry only after identifying whether the failure is transient, capacity-related, permission-related, version-related, or data-corruption-related. A successful `pg_dump` without a successful checksum, archive listing, independent copy, and periodic restore rehearsal is not sufficient recovery evidence.
