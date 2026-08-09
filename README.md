# LifeOS

**The open-source personal operating system for goals, projects, tasks, habits, and reviews.**

LifeOS connects everyday action to longer-term direction. It is designed as a multi-user, self-hostable SaaS with domain-oriented microservices, user-owned data, and auditable AI assistance.

## Status

LifeOS is in active foundation development. The current protected `main` contains the monorepo, gateway, bounded services, responsive web/PWA, PostgreSQL persistence, NATS JetStream configuration, Google/GitHub authentication, durable planning/habit/review/notification foundations, conflict-safe calendar adapters, auditable AI proposals, purpose-bound privacy access, data-rights recent-auth/request-ledger foundations, backup/restore and commercial-readiness evidence. Interfaces and migrations may still change before the first stable release.

Configured capability maturity is not whole-product completion. Canonical open buyer gaps are tracked independently in the commercial-readiness evidence and include complete data-rights orchestration, durable Today multi-device synchronization, hosted per-user calendar credentials and the plugin runtime last mile.

## Architecture

```text
Web / PWA
   |
API Gateway / BFF
   |---------------------------------------------------------------|
Identity    Planning    Habit    Review    Notification    AI/Privacy/Integrations
   |           |          |        |            |                 |
service-owned PostgreSQL schemas/databases + versioned NATS/HTTP contracts
```

The product deliberately keeps goals/projects/tasks in one Planning bounded context while other domains own their own persistence, migrations, credentials and failure behavior. Direct cross-service table access is prohibited even when an operator co-locates schemas in one physical PostgreSQL cluster.

Earlier browser-only local-first, private-personal-only, UUIDv7 and single-application primary designs are historical and superseded. Local browser drafts and Compose remain useful techniques; they do not become durable system-of-record or shared-data authority.

## Repository layout

```text
apps/
  web/
  gateway/
  identity-service/
  planning-service/
  habit-service/
  review-service/
  notification-service/
  ai-service/
  privacy-service/
  integration-calendar-service/
  integration-service/
packages/
  contracts/
  plugin-sdk/
  commercial-readiness/
infra/
docs/
```

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker with Compose

## Local development

```bash
cp .env.example .env
corepack enable
pnpm install
docker compose up -d
pnpm dev
```

Default endpoints and exact environment contracts are code/runbook controlled and can change during foundation development. Metrics endpoints contain operational data; production ingress must restrict them to the monitoring boundary.

## Authentication

Google and GitHub OAuth are the required login providers. Provider credentials are supplied through runtime secret configuration and must never be committed. Deployment operators are responsible for provider registration, redirect URI policy, secret rotation and production access controls.

LifeOS preserves the authentication ceremony time separately from session issuance/rotation. Sensitive recent-authentication policy therefore cannot be satisfied merely by rotating a session token.

## Calendar synchronization

The calendar integration service supports explicit CalDAV and Google provider modes with deterministic create/update identity and conflict-safe preconditions where the provider supports them.

The current protected-main Google adapter still documents a deployment/operator-supplied development token rather than a complete hosted multi-user connection lifecycle. Issue #129 owns encrypted per-user credentials, OAuth state/PKCE, refresh/revocation and calendar discovery/selection. Active PR #139 advances the trusted workspace-context prerequisite; it does not by itself complete #129.

## Plugin contract

The `@life-os/plugin-sdk` package defines strict versioned manifests, tenant-scoped structured event envelopes, deterministic canonical serialization and delivery-proof helpers. The integration service exposes contract discovery, manifest validation and event preparation only.

Generic plugin installation, capability grants, encrypted secret persistence, outbound delivery/retry/audit and revocation are not implied by that validation surface. Issue #130 owns that runtime boundary. Direct database access and arbitrary command execution remain non-goals.

## AI assistance

AI output is an inert proposal, not a product execution command. Proposal evidence and explicit accept/reject decisions are auditable. Deterministic product validation remains separate from bounded live-provider conformance, and model credentials/raw responses/hidden reasoning do not become retained public CI evidence.

## Data rights

Protected main now preserves real authentication age for recent-authentication policy and includes an identity-owned durable data-rights request ledger with replay/conflict semantics and immutable terminal receipt evidence. The ledger stores bounded identifiers/digests/status/timestamps rather than exported personal payloads.

Issue #55 remains open because complete product data rights also require every domain contributor, durable reconciliation, protected export delivery, retention/legal-hold/backup-expiry behavior and operator recovery. A request ledger row is not proof that every domain has completed export/erasure.

## Backup and recovery

`infra/backup/backup.sh` creates a private PostgreSQL custom-format archive, checksum and non-secret metadata set. `infra/backup/restore.sh` verifies the selected archive and restores only into a deliberately safe target according to the runbook/tests.

This logical-dump tier is not point-in-time recovery and does not schedule, encrypt, replicate or retain backups automatically. Deployment owners must follow the [backup and restore runbook](docs/operations/backup-and-restore.md), establish independent encrypted storage, rehearse recovery and add WAL/archive infrastructure where their recovery objective requires it.

## Production reference deployment

`infra/kubernetes` contains a provider-neutral Kustomize reference for current application workloads. It encodes hardened runtime defaults and explicit ownership boundaries but deliberately does not provision a cluster, PostgreSQL, NATS, ingress, TLS, DNS, registry or secret manager. Operators must follow the [production deployment runbook](docs/operations/production-deployment.md).

## Privacy and deployment responsibility

This is a public repository. It contains synthetic examples only. Personal goals, health information, relationship data, credentials, access tokens, private prompts, customer data and production exports must not be committed.

The upstream project does not operate every LifeOS deployment. A self-hosting organization controls its deployment data and must establish its own privacy notice, retention policy, security controls, subprocessors and legal basis. See the [upstream privacy notice](docs/legal/privacy.md) and [upstream project terms](docs/legal/terms.md).

## Canonical documentation

Start here for current whole-product truth. Feature plans and historical design documents provide bounded rationale but do not override protected-main evidence or the canonical status vocabulary.

- [Product Requirements (PRD)](docs/PRD.md)
- [Technical Requirements (TRD)](docs/TRD.md)
- [Repository Architecture](ARCHITECTURE.md)
- [Architecture Decision Records](docs/adr/README.md)
- [Logical Data Model / ERD](docs/DATA_MODEL.md)
- [UML and interaction views](docs/UML.md)
- [API and event contract registry](docs/API_CONTRACTS.md)
- [Vulnerability reporting](SECURITY.md)
- [Threat Model](docs/THREAT_MODEL.md)
- [Privacy and Data Lifecycle](docs/PRIVACY_DATA_LIFECYCLE.md)
- [Test Strategy](docs/TEST_STRATEGY.md)
- [Operability](docs/OPERABILITY.md)
- [Release, Migration and Rollback](docs/RELEASE_AND_MIGRATION.md)
- [Standards and Research Traceability](docs/STANDARDS_TRACEABILITY.md)
- [Requirements and Evidence Traceability](docs/TRACEABILITY.md)
- [Documentation Completeness Assessment](docs/DOCUMENTATION_ASSESSMENT.md)

Supporting evidence:

- [Original combined design (historical/scoped)](docs/superpowers/specs/2026-08-02-life-os-design.md)
- [Foundation implementation plan](docs/superpowers/plans/2026-08-02-life-os-foundation.md)
- [Gateway service-level objectives](docs/operations/service-level-objectives.md)
- [Planning-service service-level objectives](docs/operations/planning-service-level-objectives.md)
- [Backup and restore runbook](docs/operations/backup-and-restore.md)
- [Production deployment runbook](docs/operations/production-deployment.md)
- [Upstream privacy notice](docs/legal/privacy.md)
- [Upstream project terms](docs/legal/terms.md)

## Contributing

Create descriptive branches from the current `main` branch and submit reviewed pull requests back to `main`. Keep service boundaries explicit, update contracts before consumers, add realistic tests with behavior changes and avoid infrastructure without a measured need.

Contributions are accepted under the Apache License 2.0 using the inbound-equals-outbound model described in [CONTRIBUTING.md](CONTRIBUTING.md). Do not disclose unpatched vulnerabilities or sensitive evidence in public issues; use [SECURITY.md](SECURITY.md).

## License

LifeOS is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The license does not grant trademark rights beyond reasonable attribution and identification of origin.