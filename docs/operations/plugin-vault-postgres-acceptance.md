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

Hosted run `34165334271`, job `101875142628`, first proved exact infrastructure startup through verified-TLS PostgreSQL/Vault readiness, all Integration migrations, and plugin-SDK build, then localized the remaining failure to canonical formatting of the new acceptance test. Bounded repair run `34165903748`, job `101876772351`, completed GREEN on `8eb10430f31dad3317fa22242dd160eafecdb75f`, formatting only the acceptance test and removing its temporary write-scoped formatter.

The real composed-runtime proof subsequently completed successfully on exact ancestor `21b5c206decf1ca6a9b337811a56bddce39ff730`: workflow run `34166380591` (`Prove Integration Vault PostgreSQL acceptance`) finished `success` after running the purpose-bound Vault/PostgreSQL acceptance workflow on that exact SHA. This is retained evidence that the real Vault + migrated Integration-owned PostgreSQL scenario reached terminal GREEN; it is not evidence that any later descendant has unchanged-head CI/review authority.

After retaining that terminal proof, `.github/workflows/prove-integration-vault-postgres-acceptance.yml` was removed by normal descendant `430a19b08d512d0b9ea1eb1aaf78268da1f9e9d7`. The workflow was temporary acceptance machinery and is not shipped architecture. The production acceptance test and this operability/recovery contract remain in the branch.

## Acceptance boundary

The exact-ancestor GREEN above does not transfer to a later descendant, does not satisfy independent review, and is not protected-main shipped truth. #245 remains a stacked Draft until its current exact head satisfies applicable repository/security/review gates and its prerequisite stack is integrated normally. No release claim follows from the proof run alone.

The next outbound-delivery slice must preserve this ownership boundary: host-approved origin identity is not network authorization. DNS/IP resolution, redirects, proxy behavior, connect-time egress enforcement, payload/signing/idempotency, durable attempt/outcome/retry/dead-letter/recovery, and revocation fencing require their own causal contracts and current-head evidence.

## Completion and cleanup

The temporary real-environment workflow has been retired after retained terminal GREEN. Preserve this document as the durable operability/recovery evidence index, updating exact run/head evidence without reintroducing one-shot workflow source as steady-state architecture.
