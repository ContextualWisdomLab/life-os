# LifeOS

**The open-source personal operating system for goals, projects, tasks, habits, and reviews.**

LifeOS connects everyday action to longer-term direction. It is designed as a multi-user, self-hostable SaaS with domain-oriented microservices, user-owned data, and auditable AI assistance.

## Status

LifeOS is in active foundation development. The current `main` branch contains the monorepo, gateway, bounded services, responsive web shell, PostgreSQL persistence, NATS JetStream configuration, security gates, and commercial-readiness evidence loop. Interfaces and migrations may still change before the first stable release.

Canonical documents distinguish protected-main behavior from active-PR, partial, planned, research-only, superseded, and out-of-scope work. Do not use the original 2026-08-02 combined design as a parallel current PRD/TRD; it is retained as historical design input.

## Canonical documentation

Start here when evaluating or changing the whole product:

- [Product requirements](docs/PRD.md)
- [Technical requirements](docs/TRD.md)
- [Architecture](ARCHITECTURE.md)
- [Architecture decisions](docs/adr/README.md)
- [Logical data model / ERD](docs/DATA_MODEL.md)
- [UML and interaction views](docs/UML.md)
- [Security policy](SECURITY.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Operability and deployment boundary](docs/OPERABILITY.md)
- [Requirements and evidence traceability](docs/TRACEABILITY.md)
- [Documentation completeness assessment](docs/DOCUMENTATION_ASSESSMENT.md)

Scoped implementation plans, feature designs, runbooks, standards/research, and legal material remain under `docs/superpowers/`, `docs/operations/`, `docs/research/`, and `docs/legal/` as supporting evidence.

## Architecture

```text
Web / PWA
   |
API Gateway / BFF
   |-------------------------------------------------------------|
Identity   Planning   Habit   Review   AI   Calendar   Privacy   Plugin
                         |
              Notification / event consumers

Service-owned PostgreSQL persistence + versioned NATS JetStream events
```

The product deliberately keeps strongly coupled goals, projects, milestones, and tasks in one Planning bounded context. Services own their persistence boundaries; direct cross-service table access is prohibited. Internal identifiers are opaque UUIDv4 strings under the current protected-main contract.

## Repository layout

```text
apps/
  web/
  gateway/
  identity-service/
  planning-service/
  habit-service/
  review-service/
  ai-service/
  notification-service/
  privacy-service/
  integration-calendar-service/
  integration-service/
packages/
  contracts/
  plugin-sdk/
  observability/
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

Default endpoints include:

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

Exact endpoints for each bounded service are owned by current source/contracts. Metrics endpoints contain operational data; production ingress must restrict them to the monitoring network.

## Authentication

Google and GitHub OAuth are the required login providers. Provider credentials are supplied through environment variables/protected deployment secrets and must never be committed. Deployment operators are responsible for provider registration, redirect URI policy, secret rotation, and production access controls.

LifeOS maps provider identities to opaque internal UUIDv4 identities. Browser-selected workspace/actor identifiers are not trusted as authorization merely because they are syntactically valid.

## Planning, Today, habits, and reviews

Planning-service owns durable goals, projects, milestones, tasks, search, and planning mutation rules. The web Today experience can maintain explicitly labeled browser-local draft state, but local state is not durable truth until an authorized service confirms persistence.

Habit-service owns recurring habit definitions and completion history. Review-service owns review projections/snapshots and does not directly rewrite planning/habit source tables. Complete multi-device optimistic synchronization of the whole durable Today aggregate remains a product gap until protected-main evidence proves the end-to-end conflict/recovery contract.

## Calendar synchronization

The calendar integration service supports explicit `caldav` and `google` provider modes. Set `CALENDAR_PROVIDER` and the matching variables in `.env.example` before starting the service.

CalDAV writes use deterministic resource names, `If-None-Match: *` for creation, and strong `If-Match` ETags for updates. Google Calendar writes use a deterministic API event identifier to prevent duplicate creation and the same strong-ETag precondition for updates. Neither adapter exposes delete, move, or copy operations through the current LifeOS provider contract.

`GOOGLE_CALENDAR_ACCESS_TOKEN` is an operator-supplied runtime secret for this bounded adapter slice. Per-user OAuth credential storage, token refresh, revocation, calendar discovery, and encrypted persistence remain deferred and must be implemented before a multi-user hosted deployment enables unattended Google Calendar synchronization.

## Notifications

The notification service provides durable PostgreSQL reminder occurrences, expiring worker claims, immutable outcomes, timezone-aware quiet hours/fatigue controls, and idempotent in-app delivery according to its current contracts. See [notification persistence](docs/operations/notification-persistence.md) for the scoped runbook.

## AI proposals

AI output is an inert proposal, not an execution command. The AI service persists proposal evidence before return and records explicit replay-safe accept/reject decision history. It has no generic planning mutation repository/command bus.

The web boundary derives workspace/actor authority from the active session and signs the exact upstream context; browser credentials are not forwarded to the AI service. Deterministic proposal-quality/security gates are separate from bounded live-provider conformance.

## Privacy access

The privacy service provides purpose-bound authorization and durable decision/grant/event evidence for sensitive-data access. It uses explicit actor/resource/purpose/lifetime boundaries rather than treating indiscriminate masking as a complete authorization model. Public logs/errors/artifacts remain content-minimized and credential-free.

## Plugin contract

The `@life-os/plugin-sdk` package defines strict versioned manifests, tenant-scoped CloudEvents-style envelopes, deterministic canonical serialization, and delivery-proof helpers. The integration service exposes contract discovery, manifest validation, and event preparation only.

The current slice deliberately has no generic plugin installation, durable plugin secret persistence, outbound webhook delivery, inbound arbitrary commands, or direct database access. Those require separately reviewed least-privilege authorization, durable audit, and SSRF-safe delivery boundaries.

## Backup and recovery

`infra/backup/backup.sh` creates a private PostgreSQL custom-format archive, checksum, and non-secret metadata set. `infra/backup/restore.sh` verifies the selected archive and restores only into a deliberately empty non-system database. CI contracts perform real dump/restore verification, including tenant records, non-empty-target refusal, and checksum-corruption refusal.

This logical-dump tier is not point-in-time recovery and does not schedule, encrypt, replicate, or retain backups automatically. Deployment owners must follow the [backup and restore runbook](docs/operations/backup-and-restore.md), establish independent encrypted storage, rehearse recovery, and add WAL/PITR when required by their recovery objective.

## Production reference deployment

`infra/kubernetes` contains a provider-neutral Kustomize reference for current workloads. It encodes restricted runtime defaults such as non-root/read-only containers, probes, resource bounds, rolling updates, disruption budgets, topology spread, service-account restrictions, and default-deny network policy where the current manifests define them.

The protected deployment path accepts only bounded reviewed inputs and verifies its claimed workload rollback/recovery behavior. The reference does not provision a cluster, database, NATS, ingress, TLS, DNS, image pipeline, or secret manager. Operators must follow the [production deployment runbook](docs/operations/production-deployment.md) and preserve those explicit ownership boundaries.

## Privacy and deployment responsibility

This is a public repository. It contains synthetic examples only. Personal goals, health information, relationship data, credentials, access tokens, private prompts, customer data, and production exports must not be committed.

The upstream project does not operate every LifeOS deployment. A self-hosting organization controls its deployment data and must establish its own privacy notice, retention policy, security controls, subprocessors, legal basis, backups, monitoring, and incident response. See the [upstream privacy notice](docs/legal/privacy.md) and [upstream project terms](docs/legal/terms.md).

## Additional documentation

- Historical initial combined design: `docs/superpowers/specs/2026-08-02-life-os-design.md` (**historical/superseded where canonical docs differ**)
- Foundation implementation plan: `docs/superpowers/plans/2026-08-02-life-os-foundation.md`
- Gateway service-level objectives: `docs/operations/service-level-objectives.md`
- Planning-service service-level objectives: `docs/operations/planning-service-level-objectives.md`
- Plugin contract surface plan: `docs/superpowers/plans/2026-08-04-plugin-contract-surface.md`
- Backup/restore runbook: `docs/operations/backup-and-restore.md`
- Production deployment runbook: `docs/operations/production-deployment.md`
- Upstream privacy notice: `docs/legal/privacy.md`
- Upstream project terms: `docs/legal/terms.md`
- Vulnerability reporting: `SECURITY.md`

## Contributing

Create descriptive branches from the current `main` branch and submit reviewed pull requests back to `main`. Keep service boundaries explicit, update contracts before consumers, add tests with behavior changes, and avoid infrastructure without a measured need.

Contributions are accepted under the Apache License 2.0 using the inbound-equals-outbound model described in [CONTRIBUTING.md](CONTRIBUTING.md). Do not disclose unpatched vulnerabilities or sensitive evidence in public issues; use [SECURITY.md](SECURITY.md).

## License

LifeOS is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The license does not grant trademark rights beyond reasonable attribution and identification of origin.
