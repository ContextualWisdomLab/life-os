# LifeOS

**The open-source personal operating system for goals, projects, tasks, habits, and reviews.**

LifeOS connects everyday action to longer-term direction. It is designed as a multi-user, self-hostable SaaS with domain-oriented microservices, user-owned data, and auditable AI assistance.

## Status

LifeOS is in active foundation development. The current `main` branch contains the monorepo, gateway, bounded services, shared contracts, responsive web shell, PostgreSQL persistence, NATS JetStream configuration, security gates, and commercial-readiness evidence loop. Interfaces and migrations may still change before the first stable release.

## Architecture

```text
Web / PWA
   |
API Gateway / BFF
   |---------------------------------------------|
Identity       Planning       Habit       Review
   |              |             |           |
PostgreSQL schemas / databases + NATS JetStream events
```

The MVP deliberately keeps goals, projects, milestones, and tasks in one Planning bounded context. Services own their persistence boundaries; direct cross-service table access is prohibited.

## Repository layout

```text
apps/
  web/
  gateway/
  identity-service/
  planning-service/
  habit-service/
  review-service/
  integration-calendar-service/
  integration-service/
packages/
  contracts/
  plugin-sdk/
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

Default endpoints:

- Web: `http://localhost:3000`
- Gateway health: `http://localhost:4000/v1/health`
- Gateway Today composition: `http://localhost:4000/v1/today`
- Gateway Prometheus metrics: `http://localhost:4000/v1/metrics`
- Planning-service health: `http://localhost:4102/v1/health`
- Planning-service Prometheus metrics: `http://localhost:4102/v1/metrics`
- Calendar integration health: `http://localhost:4106/health`
- Calendar synchronization: `POST http://localhost:4106/v1/calendar/sync`
- Plugin integration health: `http://localhost:4107/health`
- Plugin contract discovery: `http://localhost:4107/v1/plugin-contract`
- NATS monitoring: `http://localhost:8222`

Metrics endpoints contain operational data. Production ingress must restrict them to the monitoring network.

## Authentication

Google and GitHub OAuth are the required login providers. Provider credentials are supplied through environment variables and must never be committed. Deployment operators are responsible for provider registration, redirect URI policy, secret rotation, and production access controls.

## Calendar synchronization

The calendar integration service supports explicit `caldav` and `google` provider modes. Set `CALENDAR_PROVIDER` and the matching variables in `.env.example` before starting the service.

CalDAV writes use deterministic resource names, `If-None-Match: *` for creation, and strong `If-Match` ETags for updates. Google Calendar writes use a deterministic API event identifier to prevent duplicate creation and the same strong-ETag precondition for updates. Neither adapter exposes delete, move, or copy operations through the LifeOS provider contract.

`GOOGLE_CALENDAR_ACCESS_TOKEN` is an operator-supplied runtime secret for this bounded adapter slice. Per-user OAuth credential storage, token refresh, revocation, calendar discovery, and encrypted persistence remain deferred and must be implemented before a multi-user hosted deployment enables Google Calendar synchronization.

## Plugin contract

The `@life-os/plugin-sdk` package defines strict versioned manifests, tenant-scoped CloudEvents 1.0 structured JSON envelopes, deterministic canonical serialization, and HMAC-SHA256 delivery-proof helpers. The integration service exposes contract discovery, manifest validation, and event preparation only.

This slice deliberately has no plugin installation, secret persistence, outbound webhook delivery, inbound commands, or direct database access. Those require separately reviewed least-privilege authorization, durable audit, and SSRF-safe delivery boundaries.

## Backup and recovery

`infra/backup/backup.sh` creates a private PostgreSQL custom-format archive, checksum, and non-secret metadata set. `infra/backup/restore.sh` verifies the selected archive and restores only into a deliberately empty non-system database. The Linux CI contract performs a real dump and restore with pinned PostgreSQL client tools and verifies exact tenant records, non-empty-target refusal, and checksum-corruption refusal.

This logical-dump tier is not point-in-time recovery and does not schedule, encrypt, replicate, or retain backups automatically. Deployment owners must follow the [backup and restore runbook](docs/operations/backup-and-restore.md), establish independent encrypted storage, rehearse recovery, and add WAL archiving when the required recovery point is shorter than the dump interval.

## Production reference deployment

`infra/kubernetes` contains a provider-neutral Kustomize reference for the current web and gateway edge workloads. It encodes a Restricted Pod Security namespace, non-root and read-only containers, probes, resource bounds, rolling updates, disruption budgets, topology spread, ClusterIP services, disabled service-account token automount, and default-deny network policy. The committed image digests and public origin are deliberately non-deployable sentinels.

The manual deployment workflow accepts only digest-pinned images and an exact HTTPS web origin, uses one shared renderer, optionally applies forward-only migrations, runs through the protected GitHub `production` environment, and performs server-side dry-run and diff. Before applying, it captures whether each Deployment exists and its current revision. A failed rollout must either verify rollback to that captured revision or verify deletion of a first-time Deployment; a separate failure is reported when workload-state recovery itself fails. Namespace policy, completed migrations, external infrastructure, and other non-Deployment resources are not automatically reversed. The reference does not provision a cluster, database, NATS, ingress, TLS, DNS, image pipeline, or secret manager. Operators must follow the [production deployment runbook](docs/operations/production-deployment.md) and preserve those explicit ownership boundaries.

## Privacy and deployment responsibility

This is a public repository. It contains synthetic examples only. Personal goals, health information, relationship data, credentials, access tokens, private prompts, customer data, and production exports must not be committed.

The upstream project does not operate every LifeOS deployment. A self-hosting organization controls its deployment data and must establish its own privacy notice, retention policy, security controls, subprocessors, and legal basis. See the [upstream privacy notice](docs/legal/privacy.md) and [upstream project terms](docs/legal/terms.md) for the upstream project boundary.

## Documentation

- Product and architecture design: `docs/superpowers/specs/2026-08-02-life-os-design.md`
- Foundation implementation plan: `docs/superpowers/plans/2026-08-02-life-os-foundation.md`
- Gateway service-level objectives: `docs/operations/service-level-objectives.md`
- Planning-service service-level objectives: `docs/operations/planning-service-level-objectives.md`
- [Plugin contract surface plan](docs/superpowers/plans/2026-08-04-plugin-contract-surface.md)
- [PostgreSQL backup and restore runbook](docs/operations/backup-and-restore.md)
- [Production Kubernetes deployment runbook](docs/operations/production-deployment.md)
- [Upstream privacy notice](docs/legal/privacy.md)
- [Upstream project terms](docs/legal/terms.md)
- [Vulnerability reporting](SECURITY.md)

## Contributing

Create descriptive branches from the current `main` branch and submit reviewed pull requests back to `main`. Keep service boundaries explicit, update contracts before consumers, add tests with behavior changes, and avoid infrastructure without a measured need.

Contributions are accepted under the Apache License 2.0 using the inbound-equals-outbound model described in [CONTRIBUTING.md](CONTRIBUTING.md). Do not disclose unpatched vulnerabilities or sensitive evidence in public issues; use [SECURITY.md](SECURITY.md).

## License

LifeOS is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The license does not grant trademark rights beyond reasonable attribution and identification of origin.
