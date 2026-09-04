# ADR 0004: Plugin Vault operator composition

- Status: Proposed
- Date: 2026-09-04
- Bounded context: Integration / Plugin
- Current implementation PR: #243

## Problem

`PluginVaultSecretStore` provides a concrete encrypted-secret boundary, but a provider adapter by itself is not credential authority. Production credential materialization must remain downstream of authenticated workspace/user evidence, one-time replay consumption, active installation authority, and Integration-owned credential metadata. Vault configuration must also be scoped to this service so another process cannot accidentally satisfy Plugin authority through a generic shared environment namespace.

## Constraints

- LifeOS owns Plugin installation, credential-binding, replay, and secret-reference truth; Vault owns encrypted secret bytes only.
- Plaintext plugin credentials must not enter PostgreSQL, logs, public errors, model surfaces, or durable review evidence.
- Tenant and user authority come only from the signed Plugin operator context and cannot be supplied by the request body.
- Replay evidence remains service-owned and durable across replicas.
- External Vault origin/token/mount configuration must fail closed before credential use and must not be reflected by error text.
- The composition may consume only Integration-owned ports. It must not copy Calendar secret-store source, query another service database, or depend on a mutable sibling PR head.
- Hosted PostgreSQL pool creation and shutdown are a separate runtime concern; this ADR does not treat an application factory as a deployed runtime.

## Considered alternatives

### Let HTTP controllers construct Vault directly

Rejected. Controller-level provider construction would mix transport, authentication, secret storage, and persistence ownership, make lifecycle cleanup harder to prove, and permit request handling to become the composition root.

### Use generic `PLUGIN_VAULT_*` environment variables

Rejected. Generic names weaken service-owned credential boundaries and make accidental cross-service credential reuse materially easier. The selected configuration namespace is `INTEGRATION_PLUGIN_VAULT_ORIGIN`, `INTEGRATION_PLUGIN_VAULT_TOKEN`, and `INTEGRATION_PLUGIN_VAULT_MOUNT`; the operator verifier key remains `INTEGRATION_OPERATOR_CONTEXT_SECRET`.

### Persist Vault credentials or plaintext in Integration PostgreSQL

Rejected. PostgreSQL stores only bounded Plugin metadata and opaque provider references. Vault token and plugin secret bytes remain outside service persistence.

### Compose authenticated Plugin authority over existing Integration ports

Selected. `createPluginVaultOperatorApplication` validates its configuration and dependency envelopes, creates the Plugin-owned Vault adapter, wraps it in `PluginCredentialApplication`, and supplies that credential authority to the replay-aware `PluginOperatorApplication`.

## Decision

The Integration bounded context owns the composition of authenticated Plugin credential authority. Exact service-owned environment names are mandatory; generic Vault aliases are not fallback authority. Configuration failures are reduced to `PluginVaultOperatorCompositionError` without values. The composition continues to use the existing signed method/path/workspace/user/evidence contract and durable replay guard before any credential operation can reach Vault.

The factory is not yet the hosted production bootstrap. `IntegrationAppModule` remains unmodified in this slice, and callers still supply the Integration-owned installation, credential-binding, and replay ports. Production readiness therefore requires a successor that binds those ports to one service-owned PostgreSQL pool, registers the composed operator before the listener starts, and closes the pool exactly once through the application shutdown lifecycle.

## Evidence

- RED `4469c82dd76f936475142c244143c52366f70d2f`: requires authenticated Vault operator composition.
- Initial composition `2b290cc493959957ea96de3bebcbbb4e5c95a901`.
- Non-force parent adoption/restack `d2bb1fc643b533a3cd143ba4aed62def2babb737` onto #242 exact `6cf7e1accec331dc1a06eefe9d088083ef917947`.
- Ownership RED `32b0deffa67ada6ce1214ec416f15b86f8b479bc`: requires Integration-prefixed Vault configuration and rejects generic aliases.
- Causal ownership repair `2c81ed509be937d126e59d8af3043125cd408853` plus fixture alignment `3fc1c3b0d10f7c24872028df2a26e898a0008768`.

These commits are source/test evidence only. Because #243 is a non-default stacked PR and this execution surface cannot run the workspace package graph, they are not repository-wide GREEN or release evidence.

## Risks and follow-up

The remaining highest-risk gap is hosted composition: without it, the standalone service process still starts with the fail-closed module that does not register durable Plugin operator authority. A successor must provide service-owned PostgreSQL runtime composition and exact-head integration/shutdown tests before #243 can be described as a production operator path. Subsequent work must separately own outbound HTTPS SSRF/DNS-rebinding controls, redirect/proxy policy, signing and idempotency, durable delivery attempt/outcome/retry/dead-letter/recovery, revocation fencing, and buyer-visible operator state.
