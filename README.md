# LifeOS

**The open-source personal operating system for goals, projects, tasks, habits, and reviews.**

LifeOS connects everyday action to longer-term direction. It is designed as a multi-user, self-hostable SaaS with domain-oriented microservices, user-owned data, and auditable AI assistance.

## Status

LifeOS is in active foundation development. The current protected `main` branch contains the monorepo, gateway, bounded services, shared contracts, responsive web shell, service-owned PostgreSQL persistence, NATS JetStream configuration, security gates, and commercial-readiness evidence loop. Interfaces and migrations may still change before the first stable release. Active pull requests are development evidence, not shipped capability.

## Architecture

```text
Web / PWA
   |
API Gateway / BFF
   |------------------------------------------------------------------|
Identity  Planning  Habit  Review  Calendar  Notification  AI  Privacy  Plugin
   |         |        |      |        |          |          |      |      |
          service-owned PostgreSQL + versioned HTTP/event contracts
                         NATS JetStream where required
```

The product keeps goals, projects, milestones, and tasks in the Planning bounded context. Each service owns its persistence, migrations, credentials, transaction boundaries, runtime composition and recovery. Direct cross-service table access is prohibited. Browser-local state is not durable until the owning service accepts it.

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

Google and GitHub OAuth are the required login providers. Provider registration and bootstrap credentials are deployment configuration and must never be committed. Deployment operators are responsible for redirect URI policy, secret rotation, and production access controls. Browser-supplied workspace or user identifiers never replace authenticated server authority.

## Calendar synchronization

The calendar integration service supports explicit `caldav` and `google` provider modes. CalDAV writes use deterministic resource names, `If-None-Match: *` for creation, and strong `If-Match` ETags for updates. Google Calendar writes use a deterministic API event identifier to prevent duplicate creation and the same strong-ETag precondition for updates. Neither adapter exposes delete, move, or copy operations through the LifeOS provider contract.

Protected main derives Calendar workspace/user authority from signed server context and stores only bounded connection metadata plus opaque secret references. It includes local disconnect, credential-free reads, scoped materialization, secret-first create/compensation, and a Calendar-owned encrypted self-hosted credential-store profile.

Hosted multi-user provider lifecycle is still incomplete under issue #129. Active work rejects deployment-wide Google/CalDAV credentials as end-user authority and adds bounded Google OAuth state/PKCE authority, but callback/token exchange, concrete PostgreSQL OAuth-state runtime, refresh fencing, provider revoke/delete recovery, discovery/selection and scoped synchronization remain unshipped until normal integration and completion.

## Plugin integration

The `@life-os/plugin-sdk` package defines strict versioned manifests, tenant-scoped CloudEvents 1.0 structured JSON envelopes, deterministic canonical serialization, and bounded signing helpers. A manifest expresses requested intent only; it never self-authorizes capabilities, secrets, database access or network destinations.

Protected main contains explicit installation grants, restart-safe Integration-owned PostgreSQL installation persistence, opaque credential-binding references, exact returned-evidence validation, one-time signed operator authority and fail-closed operator HTTP composition. Active issue #130 work adds host-owned normalized HTTPS delivery-origin grants, Vault KV v2 secret storage, Integration-owned PostgreSQL runtime composition and signed delivery-origin application authority. These active slices remain non-shipped and deliberately stop before complete outbound HTTPS.

A stored delivery origin is not connect-time network authorization. Complete plugin delivery still requires immutable released/versioned canonical egress authority for DNS/IP/rebinding, redirect/proxy and bounded response/time enforcement, plus durable delivery attempts/outcomes, retry/dead-letter, revocation fencing and operator recovery.

## First-party product journey

Protected main contains durable server-side Planning/Habit/Review foundations and real authenticated Today composition. Issue #209 tracks the complete first-party Goals → Projects → Tasks → Habits → Review journey. Active stacked work begins with an authenticated Goal BFF and includes durable Goals and Weekly Review workspaces, but remains Draft/non-shipped.

Commercial completion requires current-head browser E2E, Figma/Storybook traceability, normal/loading/empty/error/permission/responsive/interaction states, keyboard/focus/reduced-motion/accessibility acceptance, authoritative Review projections, and KO/EN/JA/ZH/VI/ES/DE/FR translation-ledger/font/text-expansion parity.

## Model-assisted development

LifeOS treats model output as untrusted evidence and keeps review, merge and release authority deterministic. The target automation boundary is an immutable reviewed `contextual-orchestrator` API/client with virtual `orchestrator/free`. Provider credentials, provider/model/group selection and multimodal capability discovery belong to contextual-orchestrator rather than LifeOS workflows or product code.

Protected OpenCode bootstrap hardening does not authorize direct-provider routing. Active consumer work remains fail-closed until the contextual-orchestrator authentication/bootstrap contract is repaired and published as an immutable reviewed release. LifeOS does not copy mutable owner source or fall back to direct provider selection.

## Backup and recovery

`infra/backup/backup.sh` creates a private PostgreSQL custom-format archive, checksum, and non-secret metadata set. `infra/backup/restore.sh` verifies the selected archive and restores only into a deliberately empty non-system database. The Linux CI contract performs a real dump and restore with pinned PostgreSQL client tools and verifies exact tenant records, non-empty-target refusal, and checksum-corruption refusal.

This logical-dump tier is not point-in-time recovery and does not schedule, encrypt, replicate, or retain backups automatically. Deployment owners must follow the [backup and restore runbook](docs/operations/backup-and-restore.md), establish independent encrypted storage, rehearse recovery, and add WAL archiving when the required recovery point is shorter than the dump interval.

## Production reference deployment

`infra/kubernetes` contains a provider-neutral Kustomize reference for the current web and gateway edge workloads. It encodes a Restricted Pod Security namespace, non-root and read-only containers, probes, resource bounds, rolling updates, disruption budgets, topology spread, ClusterIP services, disabled service-account token automount, and default-deny network policy. The committed image digests and public origin are deliberately non-deployable sentinels.

The manual deployment workflow accepts only digest-pinned images and an exact HTTPS web origin, uses one shared renderer, optionally applies forward-only migrations, runs through the protected GitHub `production` environment, and performs server-side dry-run and diff. Before applying, it captures whether each Deployment exists and its current revision. A failed apply or rollout must either verify rollback to that captured revision or verify deletion of a first-time Deployment; a separate failure is reported when workload-state recovery itself fails. Namespace policy, completed migrations, external infrastructure, and other non-Deployment resources are not automatically reversed. The reference does not provision a cluster, database, NATS, ingress, TLS, DNS, image pipeline, or secret manager. Operators must follow the [production deployment runbook](docs/operations/production-deployment.md) and preserve those explicit ownership boundaries.

## Release status

Issue #210 tracks immutable commercial release readiness. Active Draft release-evidence work validates structural artifact/checksum/provenance/signature evidence and detached Ed25519 signatures, but no active PR is itself a release. A stable release requires one unchanged protected source bound to version, CHANGELOG, tag, package/image, SBOM, provenance/signatures, trust-root/key lifecycle, reproducibility, migration/rollback/recovery, installed buyer-path verification and all required CI/security/review/coverage/docstring/accessibility/localization evidence.

## Privacy and deployment responsibility

This is a public repository. It contains synthetic examples only. Personal goals, health information, relationship data, credentials, access tokens, private prompts, customer data, and production exports must not be committed.

The upstream project does not operate every LifeOS deployment. A self-hosting organization controls its deployment data and must establish its own privacy notice, retention policy, security controls, subprocessors, and legal basis. See the [upstream privacy notice](docs/legal/privacy.md) and [upstream project terms](docs/legal/terms.md) for the upstream project boundary.

## Canonical product documentation

The following graph is the whole-product source of truth alongside protected-main code and root `AGENTS.md` / `ARCHITECTURE.md`:

- [Product requirements](docs/PRD.md)
- [Technical requirements](docs/TRD.md)
- [Architecture decisions](ARCHITECTURE.md)
- [ADR index](docs/adr/README.md)
- [Logical data model / ERD](docs/DATA_MODEL.md)
- [UML and interaction views](docs/UML.md)
- [API and event contracts](docs/API_CONTRACTS.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Privacy and data lifecycle](docs/PRIVACY_DATA_LIFECYCLE.md)
- [Test strategy](docs/TEST_STRATEGY.md)
- [Operability](docs/OPERABILITY.md)
- [Release, migration, and rollback](docs/RELEASE_AND_MIGRATION.md)
- [Standards and research traceability](docs/STANDARDS_TRACEABILITY.md)
- [Requirements/evidence traceability](docs/TRACEABILITY.md)
- [Documentation fitness assessment](docs/DOCUMENTATION_ASSESSMENT.md)
- [Vulnerability reporting](SECURITY.md)

Scoped feature designs, plans and runbooks remain useful evidence but do not override this code-current canonical graph.

## Additional documentation

- Product and architecture design history: `docs/superpowers/specs/2026-08-02-life-os-design.md`
- Foundation implementation plan: `docs/superpowers/plans/2026-08-02-life-os-foundation.md`
- Gateway service-level objectives: `docs/operations/service-level-objectives.md`
- Planning-service service-level objectives: `docs/operations/planning-service-level-objectives.md`
- [Plugin contract surface plan](docs/superpowers/plans/2026-08-04-plugin-contract-surface.md)
- [PostgreSQL backup and restore runbook](docs/operations/backup-and-restore.md)
- [Production Kubernetes deployment runbook](docs/operations/production-deployment.md)
- [Upstream privacy notice](docs/legal/privacy.md)
- [Upstream project terms](docs/legal/terms.md)

## Contributing

Create descriptive branches from the current `main` branch and submit reviewed pull requests back to `main`. Keep service boundaries explicit, update contracts before consumers, add tests with behavior changes, and avoid infrastructure without a measured need.

Contributions are accepted under the Apache License 2.0 using the inbound-equals-outbound model described in [CONTRIBUTING.md](CONTRIBUTING.md). Do not disclose unpatched vulnerabilities or sensitive evidence in public issues; use [SECURITY.md](SECURITY.md).

## License

LifeOS is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The license does not grant trademark rights beyond reasonable attribution and identification of origin.
