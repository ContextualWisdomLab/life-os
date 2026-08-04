# Durable AI proposal audit API slice

## Outcome

The production AI service records every inert proposal in the append-only PostgreSQL audit ledger before returning it, exposes tenant-scoped proposal and decision history, and accepts explicit replay-safe accept/reject decisions without receiving any capability to execute proposed operations or mutate user-owned data.

## Boundary

This slice composes only:

- the deterministic read-only proposal model;
- the existing immutable proposal and decision domain;
- the parameterized PostgreSQL proposal-audit repository; and
- a versioned NestJS HTTP boundary.

The production module has no planning, calendar, habit, identity, notification, event-bus, command-bus, plugin-delivery, or generic mutation dependency. `AiAppModule` remains dependency-free for the no-silent-mutation contract; `AiProductionModule` is the executable runtime and owns one PostgreSQL pool.

## Runtime configuration

`AI_DATABASE_URL` is required and must use `postgres:` or `postgresql:`. Optional integer controls are bounded before node-postgres receives them:

| Variable                         | Default | Minimum | Maximum |
| -------------------------------- | ------: | ------: | ------: |
| `AI_DATABASE_POOL_MAX`           |      10 |       1 |      32 |
| `AI_DATABASE_CONNECT_TIMEOUT_MS` |    5000 |     100 |   30000 |
| `AI_DATABASE_IDLE_TIMEOUT_MS`    |   30000 |    1000 |  300000 |

The pool uses application name `life-os-ai-service` and closes exactly once through NestJS shutdown hooks.

## HTTP contract

| Method | Route                                 | Result                                                                              |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------- |
| `POST` | `/v1/proposals`                       | Generate an inert proposal and persist verified audit evidence before returning it. |
| `GET`  | `/v1/proposals`                       | List deterministic proposal history for the trusted workspace.                      |
| `GET`  | `/v1/proposals/:proposalId`           | Return one immutable proposal revision for the trusted workspace.                   |
| `GET`  | `/v1/proposals/:proposalId/decisions` | Return append-only decision history for one tenant-scoped proposal.                 |
| `POST` | `/v1/proposals/:proposalId/decisions` | Append an explicit accept/reject event bound to the exact proposal digest.          |

Workspace scope is accepted only from `x-workspace-id`. Decision append also requires `x-actor-id`. The decision body is closed and accepts only:

- `expectedContentDigest` as a lowercase-normalized SHA-256 digest;
- `idempotencyKey` as UUIDv4;
- `decision` as `accepted` or `rejected`;
- optional bounded nonblank `reason`; and
- `decidedAt` as an RFC 3339 timestamp.

Workspace and actor headers are an internal trust contract. An authenticated gateway must derive and authorize them before the AI service is exposed beyond the private service network.

## Failure contract

The HTTP boundary emits fixed credential-free problem details:

- `400 invalid_request` for malformed headers, identifiers, bodies, or model/audit evidence;
- `404 proposal_not_found` for tenant-scoped absence;
- `409 stale_proposal` when the expected digest is not the immutable persisted revision;
- `409 idempotency_conflict` when a key is reused with another semantic decision;
- `503 audit_unavailable` for bounded persistence and unknown audit failures; and
- `503 proposal_unavailable` for non-persistence proposal generation failures.

Database messages, SQL, URLs, credentials, and submitted text are never copied into problem responses.

## Verification

Unit and PostgreSQL-backed HTTP integration evidence covers:

- bounded pool configuration and exactly-once shutdown;
- persistence before proposal return;
- restart durability;
- tenant isolation;
- deterministic list/get history;
- explicit decision append;
- exact replay returning the original event;
- stale-digest and conflicting-replay rejection;
- ownership-injection rejection;
- invalid actor, clock, and identifier handling; and
- absence of an apply or execute route.

## Deferred

The following remain separately reviewed slices:

- authenticated gateway derivation for workspace and actor context;
- external model-provider transport with bounded timeouts and closed output schemas;
- prompt/context redaction, policy evaluation, fairness and quality evaluation, and cost controls;
- separately authorized execution of accepted operations through domain-owned command boundaries; and
- data-rights retention and erasure orchestration for the append-only audit ledger.
