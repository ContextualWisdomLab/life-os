# Plugin Vault and PostgreSQL durable acceptance

Status: Draft evidence for #130/#245. This document does not establish shipped or release authority.

## Purpose

The Integration bounded context must prove that plugin installation and credential lifecycle state survives process restart while plaintext provider material remains owned by Vault and opaque binding metadata remains owned by Integration PostgreSQL persistence. The proof must exercise the production PostgreSQL repositories, production Vault KV v2 adapter, service-owned migrations, operator authentication context, installation-revocation fencing, credential revocation, and idempotent cleanup together.

## Runtime boundary

The hosted acceptance starts disposable PostgreSQL 17.10 and Vault 1.20.4 on loopback with verified TLS. PostgreSQL is pinned by container digest. The Vault archive SHA-256 is verified before execution. Database, Vault token, and operator-context credentials are generated or scoped to the disposable run and are not retained as evidence.

`apps/integration-service/src/plugin-vault-postgres-vault.integration.test.ts` composes `createPluginVaultHostedRuntime()` with the Integration-owned PostgreSQL pool and concrete `PluginVaultSecretStore`. The durable scenario is:

1. apply the complete Integration migration set;
2. install a plugin under authenticated workspace/user context;
3. bind one credential and replay the exact binding request;
4. verify the opaque active binding in PostgreSQL and provider material in Vault;
5. revoke the installation and prove a new bind is fenced;
6. close and recreate the hosted runtime;
7. revoke the credential through the restarted runtime and replay the cleanup;
8. verify PostgreSQL retains revoked metadata while Vault no longer retains provider material.

No assertion relies on a copied secret digest, cross-service SQL, mutable sibling source, or a mock Vault implementation.

## Current evidence

Hosted run `34165334271`, job `101875142628`, proved exact infrastructure startup through verified-TLS PostgreSQL/Vault readiness, all Integration migrations, and plugin-SDK build. It then failed the dedicated Prettier check before typecheck or runtime acceptance. This localized the defect to canonical formatting of the new acceptance test rather than infrastructure startup or migration execution.

Bounded repair run `34165903748`, job `101876772351`, completed GREEN on `8eb10430f31dad3317fa22242dd160eafecdb75f`: frozen install succeeded, Prettier rewrote only the acceptance test, `git diff --check` passed, and the temporary write-scoped formatter removed itself. The normal descendant is `0fbbe54166699a55fc326a9dd5393198eb7c5f95`.

The real Vault/PostgreSQL proof still requires terminal unchanged-head execution after that formatting descendant. Until formatting, typecheck, focused real acceptance, and the deterministic Integration suite all pass on the same exact head, this document remains Draft evidence and #245 remains unshipped.

## Completion and cleanup

After terminal GREEN is retained, remove `.github/workflows/prove-integration-vault-postgres-acceptance.yml` by a normal descendant because it is a purpose-bound proof workflow, then reacquire evidence for the unchanged source head. Preserve this document as the operability/recovery contract, updating exact run/head evidence rather than converting temporary workflow source into steady-state architecture.
