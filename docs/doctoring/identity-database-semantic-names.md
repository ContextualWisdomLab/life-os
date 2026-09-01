# Identity database semantic naming migration

## Bounded-context vocabulary

The Identity service owns its PostgreSQL schema. Migration `0007_identity_database_semantic_names.sql` aligns that durable schema with the repository-wide rule that organization-owned database objects use semantically specific multiword `snake_case` names.

The authoritative persistence vocabulary changes as follows:

| Legacy database name | Semantic database name |
| --- | --- |
| `identity.users` | `identity.user_accounts` |
| `users.id` | `user_accounts.user_account_id` |
| `external_identities.id` | `external_identities.external_identity_id` |
| `external_identities.user_id` | `external_identities.user_account_id` |
| `external_identities.provider` | `external_identities.identity_provider` |
| `identity.workspaces` | `identity.identity_workspaces` |
| `workspaces.id` | `identity_workspaces.identity_workspace_id` |
| `workspaces.owner_user_id` | `identity_workspaces.owner_user_account_id` |
| `workspaces.name` | `identity_workspaces.workspace_name` |
| `workspaces.kind` | `identity_workspaces.workspace_kind` |
| `identity.sessions` | `identity.authentication_sessions` |
| `sessions.id` | `authentication_sessions.authentication_session_id` |
| `sessions.user_id` | `authentication_sessions.user_account_id` |
| `sessions.workspace_id` | `authentication_sessions.identity_workspace_id` |
| `sessions.rotated_from_id` | `authentication_sessions.rotated_from_session_id` |
| `oauth_transactions.id` | `oauth_transactions.oauth_transaction_id` |
| `oauth_transactions.provider` | `oauth_transactions.identity_provider` |

Indexes and constraints are renamed in the same migration so operational evidence and database diagnostics use the same ubiquitous language.

## Compatibility boundary

This is a persistence-contract migration, not an HTTP or event contract rename. `PostgresIdentityRepository`, `PostgresSessionRepository`, and `PostgresOAuthTransactionRepository` translate the semantic PostgreSQL vocabulary into the existing TypeScript domain shapes. Existing externally visible object fields such as `user.id`, `workspace.id`, `SessionRecord.id`, and `StoredOAuthTransaction.provider` therefore remain stable at the application boundary.

The old and new database schemas are not dual-write compatible. Deploy migration `0007` together with the matching Identity-service binary. Do not run an older binary against the renamed schema or keep old and new writers active across the migration boundary.

## Migration safety and rollback

The migration performs PostgreSQL metadata renames only: it does not rewrite row payloads, introduce denormalized copies, change primary/foreign-key relationships, alter UPSERT semantics, add a hot partition, or change read/write ownership. The schema remains in the same normal form and preserves the existing Identity aggregate relationships.

`ALTER TABLE` rename operations require strong table locks. The migration is wrapped in one transaction and applies `SET LOCAL lock_timeout = '5s'`; if the complete rename set cannot acquire its locks promptly, PostgreSQL aborts the transaction and leaves the legacy schema intact. Operators should retry during a controlled low-write deployment window rather than increasing the lock timeout blindly.

Before commit, any failure rolls back the complete naming change. After a successful commit, rollback requires a matched reverse-rename migration plus the matching older application binary in a controlled maintenance window; redeploying only the older binary is unsafe.

## Verification contract

`identity-database-semantic-naming.integration.test.ts` creates a temporary PostgreSQL database, applies the pre-`0007` migration history, inserts representative legacy user, identity, workspace, session, and OAuth rows, applies `0007`, and proves that durable relationships and values survive while legacy generic table/column names disappear. Repository unit and integration tests assert the matching semantic SQL used by current readers and writers.

The migration deliberately leaves historical pre-`0007` migration fixtures using their original names when those fixtures test the old schema itself; those references are compatibility evidence, not current authoritative schema examples.

## Standards traceability

PostgreSQL documents that many `ALTER TABLE` forms acquire strong locks and that locks are normally held until transaction end. The fail-fast transactional migration is designed around that operational behavior. The existing opaque UUIDv4 identity invariant remains unchanged and follows the current UUID specification.

### References

Davis, K., Peabody, B., & Leach, P. (2024). *Universally unique IDentifiers (UUIDs) (RFC 9562).* RFC Editor. https://www.rfc-editor.org/rfc/rfc9562

PostgreSQL Global Development Group. (2026). *PostgreSQL 18 documentation: ALTER INDEX.* https://www.postgresql.org/docs/18/sql-alterindex.html

PostgreSQL Global Development Group. (2026). *PostgreSQL 18 documentation: Explicit locking.* https://www.postgresql.org/docs/18/explicit-locking.html
