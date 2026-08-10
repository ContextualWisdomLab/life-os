# Changelog

All notable changes to LifeOS are documented in this file.

## Unreleased

### Added

- An authenticated calendar-connection disconnect application and optional hosted HTTP composition boundary that derives workspace and requesting-user authority only from the signed `life-os.calendar-user.v1` context and returns credential-free local revocation evidence.
- A durable PostgreSQL data-rights request ledger with workspace-scoped idempotency, immutable request and terminal receipt digests, one-way completion state, and real integration evidence that erasure receipts survive removal of the source workspace and user.
- Migration `0006_data_rights_request_ledger.sql` for the service-owned identity ledger, retaining only bounded opaque authority references and digest/status/timestamp evidence rather than exported personal payloads.
- An hourly and manually dispatchable NVIDIA NIM live-conformance harness that pins contextual-orchestrator to an exact reviewed commit, compares strong single-route reasoning with bounded conducted workflows, and retains only validated credential-free quality, safety, orchestration, usage, and ablation evidence.
- A versioned, immutable AI proposal quality evaluator that separates production validity, semantic operation conformance, evidence grounding, benign utility, forbidden-text leakage, and prompt-injection resistance across realistic English, Korean, temporal, empty-context, completed-item, and adversarial fixtures.
- An explicit `contextual-orchestrator` proposal-model mode with bounded OpenAI-compatible transport, strict structured output, model provenance, and an independent local rule-based default.
- Executable AI-service JSDoc and exact 100% statement, branch, function, and line coverage gates, with an operator-facing governance assurance boundary.
- Tenant-safe durable planning search across goals, projects, and tasks, with Unicode-normalized exact, prefix, and whole-token matching.
- An authenticated same-origin planning-search boundary that signs the session-derived workspace context and forwards no browser credential to planning-service.
- An accessible quick-capture and search surface that keeps browser-local Today drafts visibly separate from durable workspace records.
- Complete English and Korean message catalogs, a persisted keyboard-operable language selector, localized live-region announcements, and accessibility browser journeys for the Today action loop.
- A bounded notification scheduler with IANA time-zone quiet hours, per-local-day fatigue limits, tenant-scoped atomic claims, idempotent delivery keys, and credential-free retry outcomes.
- Durable PostgreSQL reminder occurrences, expiring worker claims, immutable scheduler outcomes, and an idempotent in-app inbox in the independent `notification_service` schema.
- A bounded notification runtime that composes one PostgreSQL pool, the reminder repository, the in-app gateway, and the scheduler with exactly-once pool shutdown.
- A production AI runtime that persists every inert proposal before returning it and exposes tenant-scoped proposal evidence and append-only accept/reject decision history.
- Replay-safe AI proposal decisions bound to the exact workspace, actor, proposal revision digest, UUIDv4 idempotency key, and decision timestamp.
- An authenticated same-origin AI proposal boundary that derives workspace and actor identity from the active session, signs the exact upstream method and path, and never forwards browser credentials to AI service.

### Fixed

- Data-rights request-ID and idempotency collisions now resolve through stable credential-free domain conflicts instead of exposing raw PostgreSQL uniqueness errors, including ambiguous dual-collision evidence.
- The OpenCode development loop now prevents project settings from overriding its pinned offline NVIDIA model, records catalog failures accurately, parses the accepted candidate's exact Compose file outside the model account, and requires digest-pinned PostgreSQL queries plus NATS JetStream probes in pull-request CI.
- Live contextual-orchestrator responses now classify successful empty bodies as evaluation failures, emit exactly one terminal observation, canonicalize retained timestamps safely, and preserve null metric denominators instead of fabricating deltas.
- Stale AI proposal revision conflicts now belong to the technology-independent audit domain while the PostgreSQL adapter preserves its compatibility export.
- Planning search now normalizes browser query text and prevents stale or unmounted requests from replacing the latest visible result state.
- Reminder fatigue deferral now crosses long IANA offset fallbacks and next-day quiet hours without abandoning the claimed occurrence.
- Notification workers now recover expired claims and exact delivery replays without creating duplicate inbox messages.
- Notification batches now isolate delivery-count persistence failures, issue a distinct token for each claim attempt, share concurrent shutdown work, and emit bounded credential-free PostgreSQL failure classifications.

### Security

- Calendar local disconnect never accepts client-selected ownership as authority, never reads provider secret handles, revalidates durable revocation evidence against the signed workspace+user context, and maps absent or differently owned connections to the same public not-found result.
- The data-rights request ledger keeps personal export payloads out of durable audit rows and normalizes primary-key/idempotency collisions before dependency errors can escape the service boundary.
- The commercial-development model account no longer performs Docker commands, never receives Docker-socket authority, and cannot trigger provider-wide model discovery through the credential bridge.
- The scheduled live-model harness uses only `NVIDIA_NIM_API_KEY`, seeds it through the encrypted contextual-orchestrator credential registry, installs hash-locked dependencies from an exact commit, confines LifeOS traffic to loopback, allowlists NVIDIA NIM egress, and excludes provider credentials, prompts, responses, traces, and hidden reasoning from retained artifacts.
- Proposal quality reports now discard nested model failures and response bodies, normalize labeled sentinel checks, expose no provider credential or mutation dependency, and measure prompt-injection resistance together with benign utility instead of rewarding blanket refusal.
- External proposal generation now accepts only one credential-free HTTPS orchestrator origin, stops responses at 65536 bytes, enforces a bounded abort timeout, supplies no tools, treats planning context as untrusted data, and exposes only sanitized failures.
- AI gateway service-context authentication now carries an integrity-protected key identifier, signs only with one active key, verifies one explicitly selected active or previous key during a bounded overlap, and rejects retired identifiers immediately without trial verification.
- Planning-search upstream responses are stopped at a fixed byte limit before they can be fully buffered by the web boundary.
- Notification persistence stores SHA-256 idempotency digests instead of raw delivery keys, validates every untrusted row, and keeps all SQL tenant-scoped and parameterized.
- The AI production boundary rejects direct client-selected ownership headers, verifies a short-lived HMAC-SHA-256 context bound to workspace, actor, HTTP method, and exact path, returns credential-free problem details, and exposes no proposal apply or execution route.
- The AI web boundary consumes and bounds identity-session response streams exactly once, avoiding unbounded buffering from cloning an untrusted streamed response.
