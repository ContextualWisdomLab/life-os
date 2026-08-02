# LifeOS Product and Architecture Design

**Date:** 2026-08-02  
**Status:** Proposed for implementation  
**Repository:** `ContextualWisdomLab/life-os`

## 1. Product Vision

LifeOS is an open-source, multi-user personal operating system for turning long-term intentions into executable work. It connects goals, projects, tasks, habits, calendar commitments, reflection, and AI assistance in one coherent model.

The product is not intended to be another flat checklist. Its core value is traceability:

> Every task should answer what larger goal it serves, and every goal should show what is actually being done next.

The public project must be usable by people other than its creator. Personal data is therefore never committed to the repository. The repository contains only generic fixtures and sample data.

## 2. Target Users

### Primary users

- Individuals managing personal, health, career, learning, and relationship goals
- Knowledge workers who need goal-to-task traceability
- Users who want Google Calendar and GitHub-connected planning
- Self-hosters who prefer an open-source alternative to closed productivity platforms

### Secondary users

- Small teams sharing goals and projects
- Developers building plugins or integrations
- Researchers interested in personal analytics, planning, or behavioral data

## 3. Product Principles

1. **Goal-connected work**: tasks and habits should connect to projects or goals when relevant.
2. **User-owned data**: users can export their complete data in a documented format.
3. **Privacy by design**: each user's records are isolated at the application and database layers.
4. **Open deployment**: the system must run locally with Docker Compose and scale to Kubernetes.
5. **API first**: first-party clients use the same documented service APIs exposed to integrations.
6. **Progressive complexity**: the UI should remain useful for a simple todo list while supporting richer planning.
7. **Auditable AI**: AI suggestions are distinguishable from user-authored data and require explicit user acceptance before mutation.

## 4. Scope

### MVP scope

- Google and GitHub OAuth login
- User profile and preferences
- Workspaces, initially one personal workspace per user
- Goals with hierarchy and status
- Projects connected to goals
- Tasks connected to projects or goals
- Habits and recurrence rules
- Daily and weekly planning views
- Completion history
- Dashboard with basic progress metrics
- JSON import and export
- Responsive web application and installable PWA
- Docker Compose development and self-hosting environment
- OpenAPI documentation
- Baseline observability and audit logging

### Post-MVP scope

- Google Calendar bidirectional synchronization
- Notifications and reminders
- Journal and review workflows
- AI planning, coaching, and reflection
- Team workspaces and sharing
- Plugin SDK and MCP server
- Outlook, Notion, email, and Apple ecosystem integrations
- Event-driven analytics and advanced reporting
- Native mobile clients

### Explicitly out of scope for MVP

- Medical or psychological diagnosis
- Automated consequential decision-making
- Autonomous AI changes without confirmation
- Billing and paid subscriptions
- Real-time collaborative editing
- Full offline-first conflict resolution
- Complex gamification

## 5. User Experience

### Primary navigation

- **Today**: overdue, due today, scheduled habits, and the user's selected daily priorities
- **Goals**: hierarchical goals, outcomes, progress, and linked projects
- **Projects**: active projects, milestones, next actions, and status
- **Tasks**: inbox, upcoming, completed, and filters
- **Habits**: recurrence, streaks, completion history, and adherence
- **Review**: weekly summary and planning workflow
- **Settings**: identity, integrations, export, and account management

### Core workflow

1. User signs in with Google or GitHub.
2. The system provisions a personal workspace.
3. User captures an item in the inbox.
4. User classifies it as a goal, project, task, or habit.
5. User optionally connects it to a parent objective.
6. Today view surfaces actionable work.
7. Completion events update progress and history.
8. Weekly review identifies stalled goals, inactive projects, overdue tasks, and habit adherence.

### Accessibility

- Keyboard-operable primary workflows
- Semantic HTML and visible focus states
- WCAG 2.2 AA target
- Reduced-motion support
- No status communicated by color alone
- Korean and English localization-ready architecture from the start

## 6. Domain Model

### Identity bounded context

- `User`
- `ExternalIdentity`
- `Session`
- `UserPreference`

### Workspace bounded context

- `Workspace`
- `WorkspaceMember`
- `Role`

The MVP automatically creates one personal workspace. The data model supports future team workspaces without exposing team UI initially.

### Planning bounded context

- `Goal`
- `Project`
- `Milestone`
- `Task`
- `TaskDependency`
- `Tag`

Relationships:

- A goal may have a parent goal.
- A project may support one or more goals.
- A task may belong to a project and may directly support a goal.
- A milestone belongs to a project.
- Dependencies are directed relationships between tasks.

### Habit bounded context

- `Habit`
- `RecurrenceRule`
- `HabitOccurrence`
- `HabitCompletion`

Habit definitions are separate from generated occurrences. This avoids mutating historical records when a recurrence rule changes.

### Review bounded context

- `DailyPlan`
- `DailyPriority`
- `WeeklyReview`
- `ReviewObservation`

### Audit bounded context

- `AuditEvent`
- `DataExportJob`
- `AccountDeletionJob`

## 7. Service Architecture

LifeOS will use a domain-oriented MSA, but the MVP will avoid gratuitous fragmentation. Each service must own a coherent business capability and its persistence schema.

### Initial services

#### 7.1 Web application

- Next.js and TypeScript
- Responsive PWA
- Server-side rendering where useful
- Calls the gateway only; it does not access service databases

#### 7.2 API gateway / BFF

- Public API entry point
- Request authentication and authorization context propagation
- Rate limiting
- API composition for client views
- Correlation IDs and standardized error responses
- REST externally; internal transport may evolve independently

#### 7.3 Identity service

- Google OAuth and GitHub OAuth
- Session issuance, rotation, and revocation
- Linked identity management
- Personal workspace provisioning trigger
- Account deletion orchestration

Recommended implementation: TypeScript service with Auth.js-compatible OAuth handling, while keeping identity persistence and token policy inside the service.

#### 7.4 Planning service

Owns:

- goals
- projects
- milestones
- tasks
- tags
- task dependencies
- daily priority selection

These concepts remain together initially because they form one highly connected consistency boundary. They can be split later based on load or team ownership, not speculation.

#### 7.5 Habit service

Owns:

- habit definitions
- recurrence calculation
- generated occurrences
- completion history
- streak calculation

#### 7.6 Review service

Owns:

- daily plans
- weekly review snapshots
- progress aggregation
- stalled-item detection

It consumes domain events and maintains read-optimized projections. It must not become the source of truth for goals, tasks, or habits.

#### 7.7 Notification service

Post-MVP implementation boundary reserved in the monorepo. It consumes reminder requests and completion events and sends in-app, email, or push notifications.

#### 7.8 Integration service

Post-MVP boundary for Google Calendar and other third-party systems. OAuth credentials for integrations are separate from login identities and encrypted at rest.

#### 7.9 AI service

Post-MVP isolated service for provider routing, prompt templates, safety rules, redaction, and structured suggestions. It cannot directly modify planning data. It returns proposals that the user must accept through the planning API.

## 8. Communication Model

### Synchronous communication

- Client to gateway: HTTPS REST/JSON
- Gateway to services: REST initially, using generated OpenAPI clients
- Service-to-service synchronous calls are permitted only for request-time validation that cannot tolerate eventual consistency

### Asynchronous communication

NATS JetStream is the preferred initial event bus because it is operationally lighter than Kafka for an early open-source deployment while still supporting durable consumers.

Representative events:

- `identity.user.created.v1`
- `workspace.personal.created.v1`
- `planning.goal.created.v1`
- `planning.goal.updated.v1`
- `planning.project.created.v1`
- `planning.task.created.v1`
- `planning.task.completed.v1`
- `habit.occurrence.generated.v1`
- `habit.occurrence.completed.v1`
- `review.weekly.generated.v1`

Event requirements:

- immutable payload
- event ID
- event type and schema version
- timestamp
- actor ID
- workspace ID
- correlation and causation IDs
- idempotent consumers
- outbox pattern for reliable publication

## 9. Data Architecture

### Database strategy

- PostgreSQL is the system of record.
- Each service owns a separate schema and database credentials.
- Direct cross-service table access is prohibited.
- A single PostgreSQL cluster may host multiple service databases in development and small deployments.
- Production deployments may separate clusters without changing service contracts.

### Tenant isolation

Every domain record includes `workspace_id`. Authorization is enforced:

1. at the gateway through authenticated identity context;
2. in each service through workspace membership checks;
3. through database policies or mandatory query scoping where practical;
4. through tests that attempt cross-tenant access.

### Identifier and time policy

- UUIDv7 identifiers
- UTC timestamps in persistence and APIs
- User timezone stored as an IANA timezone
- Soft deletion only where recovery or audit requires it; otherwise explicit deletion

### Export format

A versioned JSON archive contains:

- manifest
- profile and preferences
- goals
- projects
- tasks
- habits and history
- reviews
- attachments metadata

Secrets, access tokens, audit internals, and password-equivalent credentials are excluded.

## 10. Authentication and Authorization

### Login providers

- Google OAuth 2.0 / OpenID Connect
- GitHub OAuth

A user may link both providers to one account after proving control of the active session and the new identity.

### Session policy

- Secure, HttpOnly, SameSite cookies for web sessions
- Short-lived access token or opaque session identifier
- Rotating refresh/session credentials
- Server-side revocation
- CSRF protection for state-changing browser requests

### Authorization model

MVP workspace roles:

- `owner`
- `admin`
- `member`
- `viewer`

Only `owner` is exercised in the initial personal workspace UI, but authorization checks use the complete role model.

## 11. Security and Privacy

- OAuth secrets and encryption keys supplied only through secret management
- No secrets committed to Git
- Input validation at every service boundary
- Parameterized database access through an ORM or query builder
- Content Security Policy
- Secure cookie configuration
- Dependency and container scanning in CI
- SBOM generation for releases
- Rate limits for authentication and write APIs
- Audit records for login, identity linking, export, deletion, and privileged workspace changes
- Encryption in transit
- Encrypted third-party integration tokens at rest
- Data retention and account deletion workflows documented before public hosting

Personal screenshots and the creator's private todo list are not included as fixtures. Generic sample data will demonstrate the same product concepts without exposing personal details.

## 12. Error Handling

All APIs use a standard problem response compatible with RFC 9457 fields:

- `type`
- `title`
- `status`
- `detail`
- `instance`
- `code`
- `correlationId`
- optional field validation errors

Services distinguish:

- validation errors
- authentication failures
- authorization failures
- not found
- conflict and optimistic concurrency failures
- rate limiting
- dependency unavailable
- unexpected internal error

Internal stack traces and secrets are never returned to clients.

## 13. Observability

- OpenTelemetry instrumentation
- Structured JSON logs
- Trace and correlation IDs propagated across gateway, services, and events
- Prometheus-compatible metrics
- Health, readiness, and liveness endpoints
- Basic dashboards for request latency, error rates, queue lag, authentication failures, and database saturation
- Local development bundle may use Grafana, Prometheus, Loki, and Tempo

## 14. Monorepo Structure

```text
life-os/
├── apps/
│   ├── web/
│   ├── gateway/
│   ├── identity-service/
│   ├── planning-service/
│   ├── habit-service/
│   └── review-service/
├── packages/
│   ├── ui/
│   ├── contracts/
│   ├── event-schemas/
│   ├── observability/
│   ├── config/
│   └── test-support/
├── infra/
│   ├── compose/
│   ├── kubernetes/
│   ├── terraform/
│   └── observability/
├── docs/
│   ├── adr/
│   ├── api/
│   └── superpowers/specs/
├── .github/workflows/
├── pnpm-workspace.yaml
└── turbo.json
```

### Technology baseline

- TypeScript across the initial web and services
- Next.js for the web application
- NestJS for gateway and domain services
- PostgreSQL
- Prisma or Drizzle selected during implementation planning after evaluating migration and schema ownership requirements
- NATS JetStream
- Redis only when a measured need exists for caching, rate limiting, or distributed coordination
- pnpm and Turborepo
- Docker and Kubernetes manifests

Using one language in the MVP reduces operational and contributor complexity. Service boundaries remain language-neutral through OpenAPI and event schemas.

## 15. API Design

- REST resources use plural nouns and stable IDs.
- OpenAPI 3.1 is the source of truth for synchronous contracts.
- Mutating operations support idempotency keys where duplicate submission is plausible.
- Pagination uses opaque cursors.
- Filtering and sorting conventions are consistent across resources.
- Optimistic concurrency uses version numbers or ETags for destructive updates.
- Breaking changes require a new API or event schema version.

Representative endpoints:

```text
POST   /v1/auth/google/start
POST   /v1/auth/github/start
POST   /v1/auth/logout
GET    /v1/me
GET    /v1/workspaces
GET    /v1/goals
POST   /v1/goals
PATCH  /v1/goals/{goalId}
GET    /v1/projects
POST   /v1/projects
GET    /v1/tasks
POST   /v1/tasks
POST   /v1/tasks/{taskId}/complete
GET    /v1/habits
POST   /v1/habits
POST   /v1/habit-occurrences/{occurrenceId}/complete
GET    /v1/today
GET    /v1/reviews/weekly/current
POST   /v1/exports
```

## 16. Testing Strategy

### Unit tests

- domain invariants
- recurrence calculations
- progress calculations
- authorization decisions
- event serialization

### Integration tests

- service repositories against PostgreSQL containers
- outbox publication
- NATS consumers and idempotency
- OAuth callback handling with provider stubs
- tenant isolation

### Contract tests

- OpenAPI compatibility
- generated client validation
- event schema compatibility

### End-to-end tests

- first login and workspace provisioning
- create goal → project → task → complete task
- create recurring habit → generate occurrence → complete occurrence
- export user data
- reject cross-workspace access

### Non-functional tests

- accessibility checks
- basic load tests for core reads and writes
- container vulnerability scans
- migration rollback or forward-fix verification

## 17. Deployment

### Local and self-hosted

Docker Compose provides:

- web
- gateway
- services
- PostgreSQL
- NATS
- optional observability stack

### Scaled deployment

Kubernetes resources provide:

- independent service deployments
- horizontal autoscaling
- network policies
- ingress
- secrets integration
- database migrations as controlled jobs

Terraform support will target one documented reference cloud after the portable Docker and Kubernetes paths are stable.

## 18. Delivery Phases

### Phase 0: foundation

- repository standards
- architecture decision records
- monorepo tooling
- shared contracts and observability
- Docker Compose
- CI pipeline

### Phase 1: identity and workspace

- Google and GitHub login
- sessions
- personal workspace provisioning
- authorization middleware

### Phase 2: planning core

- goals
- projects
- tasks
- Today view
- basic dashboard

### Phase 3: habits and reviews

- recurrence engine
- completion history
- daily priorities
- weekly review projections

### Phase 4: portability and release

- JSON import/export
- PWA installation
- deployment documentation
- Kubernetes reference manifests
- security review and first tagged release

### Phase 5: integrations and AI

- Google Calendar
- notification service
- AI proposal workflow
- plugin and MCP interfaces

## 19. Success Criteria for the First Public Release

- A new user can sign in using Google or GitHub.
- The user receives an isolated personal workspace.
- The user can create a goal, connect a project, create a task, and complete it.
- The user can create a recurring habit and record completion.
- Today view presents tasks and habit occurrences relevant to the date.
- Weekly review displays progress based on immutable completion history.
- The user can export all user-authored data.
- Cross-user access tests pass.
- The entire stack starts from documented commands with Docker Compose.
- CI verifies formatting, type checking, tests, contract compatibility, build, and container security.
- No personal data or production secret is present in the public repository.

## 20. Architectural Constraints and Decisions

1. MSA boundaries follow domains, not individual entities.
2. Planning remains one service in the MVP; goal, project, and task are not prematurely split.
3. Each service owns its persistence and publishes domain events through an outbox.
4. NATS JetStream is the initial event backbone.
5. External APIs are REST/OpenAPI; asynchronous contracts use versioned JSON Schema.
6. AI is advisory and cannot silently mutate user data.
7. Public fixtures are synthetic.
8. The repository supports both simple Docker Compose deployment and future Kubernetes scale.

## 21. Open Implementation Decisions

The following are deliberately deferred to the implementation plan rather than left ambiguous in the product design:

- Prisma versus Drizzle
- exact OAuth/session library integration
- gateway framework configuration
- initial Kubernetes distribution used for automated tests
- reference cloud for Terraform

Each decision will be recorded as an ADR with evaluation criteria, selected option, and consequences before dependent implementation begins.
