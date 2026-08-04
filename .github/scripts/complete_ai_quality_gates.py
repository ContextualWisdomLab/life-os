#!/usr/bin/env python3
"""Apply the reviewed AI service assurance design before exact-head verification."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    """Read one repository UTF-8 text file."""
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    """Write one repository UTF-8 text file with a terminal newline."""
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    """Replace one reviewed source fragment or fail closed when the source moved."""
    text = read(path)
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    write(path, text.replace(old, new, 1))


def ensure_before(path: str, marker: str, comment: str) -> None:
    """Insert one explanatory JSDoc block immediately before an exact marker."""
    text = read(path)
    replacement = f"{comment}\n{marker}"
    if replacement in text:
        return
    count = text.count(marker)
    if count != 1:
        raise RuntimeError(f"expected one marker in {path}, found {count}: {marker}")
    write(path, text.replace(marker, replacement, 1))


def document_runtime() -> None:
    """Document the remaining AI runtime aliases and adapter constructors."""
    path = "apps/ai-service/src/ai-runtime.ts"
    ensure_before(
        path,
        "type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;",
        "/** Bounded environment values accepted by the AI production runtime. */",
    )
    replace_once(
        path,
        """class NodePostgresAiPool implements AiPool {
  constructor(private readonly pool: Pool) {}
""",
        """class NodePostgresAiPool implements AiPool {
  /** Creates the bounded adapter around one owned node-postgres pool. */
  constructor(private readonly pool: Pool) {}
""",
    )
    replace_once(
        path,
        """class NodePostgresProposalAuditSqlClient implements ProposalAuditSqlClient {
  constructor(private readonly pool: AiPool) {}
""",
        """class NodePostgresProposalAuditSqlClient implements ProposalAuditSqlClient {
  /** Creates the repository SQL adapter over the runtime-owned pool. */
  constructor(private readonly pool: AiPool) {}
""",
    )


def document_proposal_service() -> None:
    """Document every production proposal validation and generation boundary."""
    path = "apps/ai-service/src/proposal-service.ts"
    replace_once(
        path,
        """export interface ProposalModel {
  generate(input: ProposalRequest): Promise<ProposalModelDraft>;
}

export type ProposalClock = () => Date;
export type ProposalIdFactory = () => string;
""",
        """export interface ProposalModel {
  /** Produces one untrusted structured suggestion from validated read-only evidence. */
  generate(input: ProposalRequest): Promise<ProposalModelDraft>;
}

/** Supplies deterministic proposal creation time in tests and production. */
export type ProposalClock = () => Date;
/** Supplies opaque UUIDv4 proposal identifiers. */
export type ProposalIdFactory = () => string;
""",
    )
    replace_once(
        path,
        """export class ProposalValidationError extends Error {
  constructor() {
""",
        """export class ProposalValidationError extends Error {
  /** Creates a stable credential-free validation failure. */
  constructor() {
""",
    )
    comments = {
        "function invalid(): never {": "/** Raises the shared bounded proposal validation failure. */",
        "function requireString(value: unknown, maximumLength: number): string {": "/** Requires one trimmed non-empty string within an explicit maximum length. */",
        "function requireUuidV4(value: unknown): string {": "/** Requires and canonicalizes one opaque UUIDv4 identifier. */",
        "function requireRecord(value: unknown): Readonly<Record<string, unknown>> {": "/** Requires an object-shaped untrusted value. */",
        "function requireExactKeys(\n": "/** Rejects missing, unknown, or duplicate object fields through an exact key set. */",
        "function requireContextItem(value: unknown): ProposalContextItem {": "/** Validates one read-only planning evidence item. */",
        "function validateRationale(value: unknown): readonly string[] {": "/** Validates a bounded non-empty rationale collection. */",
        "function validateOperation(value: unknown): ProposalOperation {": "/** Validates one inert user-confirmable proposed operation. */",
        "function validateOperations(value: unknown): readonly ProposalOperation[] {": "/** Validates a bounded non-empty operation collection. */",
        "function boundedInterpolation(\n": "/** Interpolates untrusted text into a fixed-size model response without overflow. */",
    }
    for marker, comment in comments.items():
        ensure_before(path, marker, comment)
    replace_once(
        path,
        """export class RuleBasedProposalModel implements ProposalModel {
  async generate(input: ProposalRequest): Promise<ProposalModelDraft> {
""",
        """export class RuleBasedProposalModel implements ProposalModel {
  /** Produces one deterministic inert proposal draft from validated evidence. */
  async generate(input: ProposalRequest): Promise<ProposalModelDraft> {
""",
    )
    replace_once(
        path,
        """export class ProposalService {
  constructor(
""",
        """export class ProposalService {
  /** Creates the generator with explicit model, clock, and identifier seams. */
  constructor(
""",
    )
    ensure_before(
        path,
        "  async generateProposal(\n",
        "  /** Validates input and model output before returning one immutable inert proposal. */",
    )


def move_stale_revision_error() -> None:
    """Move stale-revision semantics into the domain and preserve adapter compatibility."""
    domain = "apps/ai-service/src/proposal-audit-domain.ts"
    validation_block = """export class ProposalAuditValidationError extends Error {
  constructor() {
    super('Proposal audit evidence is invalid');
    this.name = 'ProposalAuditValidationError';
  }
}
"""
    replacement = validation_block.replace(
        "  constructor() {",
        "  /** Creates a stable credential-free audit validation failure. */\n  constructor() {",
        1,
    ) + """

/** Raised when a decision references a stale or unknown proposal digest. */
export class ProposalDigestMismatchError extends Error {
  /** Creates a stable conflict representing an immutable revision mismatch. */
  constructor() {
    super('Proposal content digest does not match persisted evidence');
    this.name = 'ProposalDigestMismatchError';
  }
}
"""
    replace_once(domain, validation_block, replacement)

    repository = "apps/ai-service/src/postgres-proposal-audit-repository.ts"
    replace_once(
        repository,
        """  ProposalAuditValidationError,
  type ProposalDecisionEvent,
""",
        """  ProposalAuditValidationError,
  ProposalDigestMismatchError,
  type ProposalDecisionEvent,
""",
    )
    replace_once(
        repository,
        """} from './proposal-audit-domain';

/** Minimal parameterized SQL result boundary for proposal audit persistence. */
""",
        """} from './proposal-audit-domain';

export { ProposalDigestMismatchError } from './proposal-audit-domain';

/** Minimal parameterized SQL result boundary for proposal audit persistence. */
""",
    )
    old_error = """/** Raised when a decision references a stale or unknown proposal digest. */
export class ProposalDigestMismatchError extends Error {
  constructor() {
    super('Proposal content digest does not match persisted evidence');
    this.name = 'ProposalDigestMismatchError';
  }
}

"""
    text = read(repository)
    if old_error in text:
        write(repository, text.replace(old_error, "", 1))

    application = "apps/ai-service/src/proposal-audit-application.ts"
    replace_once(
        application,
        """  createProposalDecisionEvent,
  ProposalAuditValidationError,
} from './proposal-audit-domain';
""",
        """  createProposalDecisionEvent,
  ProposalAuditValidationError,
  ProposalDigestMismatchError,
} from './proposal-audit-domain';
""",
    )
    text = read(application)
    text = text.replace(
        "import { ProposalDigestMismatchError } from './postgres-proposal-audit-repository';\n",
        "",
    )
    write(application, text)

    main = "apps/ai-service/src/main.ts"
    replace_once(
        main,
        """  type ProposalAuditRecord,
  ProposalAuditValidationError,
  type ProposalDecisionEvent,
""",
        """  type ProposalAuditRecord,
  ProposalAuditValidationError,
  ProposalDigestMismatchError,
  type ProposalDecisionEvent,
""",
    )
    replace_once(
        main,
        """  ProposalAuditPersistenceError,
  ProposalDecisionConflictError,
  ProposalDigestMismatchError,
""",
        """  ProposalAuditPersistenceError,
  ProposalDecisionConflictError,
""",
    )

    test_path = "apps/ai-service/src/proposal-audit-domain.test.ts"
    replace_once(
        test_path,
        """  ProposalAuditValidationError,
  validateProposalAuditRecord,
""",
        """  ProposalAuditValidationError,
  ProposalDigestMismatchError,
  validateProposalAuditRecord,
""",
    )
    replace_once(
        test_path,
        """  it('rejects numeric identifiers and malformed decision digests', () => {
""",
        """  it('owns stale immutable revision semantics in the audit domain', () => {
    expect(new ProposalDigestMismatchError()).toMatchObject({
      name: 'ProposalDigestMismatchError',
      message: 'Proposal content digest does not match persisted evidence',
    });
  });

  it('rejects numeric identifiers and malformed decision digests', () => {
""",
    )


def document_audit_domain() -> None:
    """Document every domain port, validator, and canonicalization helper."""
    path = "apps/ai-service/src/proposal-audit-domain.ts"
    replace_once(
        path,
        """export interface ProposalAuditRepository {
  saveProposal(record: ProposalAuditRecord): Promise<void>;
  findProposal(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalAuditRecord | undefined>;
  listProposals(workspaceId: string): Promise<ProposalAuditRecord[]>;
  appendDecision(event: ProposalDecisionEvent): Promise<ProposalDecisionEvent>;
  listDecisions(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalDecisionEvent[]>;
}
""",
        """export interface ProposalAuditRepository {
  /** Persists one immutable proposal revision and its canonical provenance. */
  saveProposal(record: ProposalAuditRecord): Promise<void>;
  /** Finds one tenant-owned immutable proposal revision. */
  findProposal(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalAuditRecord | undefined>;
  /** Lists deterministic proposal evidence for one workspace. */
  listProposals(workspaceId: string): Promise<ProposalAuditRecord[]>;
  /** Appends or exactly replays one immutable decision event. */
  appendDecision(event: ProposalDecisionEvent): Promise<ProposalDecisionEvent>;
  /** Lists append-only decision history for one tenant-owned proposal. */
  listDecisions(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalDecisionEvent[]>;
}
""",
    )
    comments = {
        "function invalid(): never {": "/** Raises the shared bounded audit validation failure. */",
        "function requireRecord(value: unknown): Readonly<Record<string, unknown>> {": "/** Requires an object-shaped untrusted or persisted value. */",
        "function requireExactKeys(\n": "/** Requires one exact closed set of object fields. */",
        "function requireString(value: unknown, maximumLength: number): string {": "/** Requires one trimmed non-empty string within an explicit maximum length. */",
        "function requireUuidV4(value: unknown): string {": "/** Requires and canonicalizes one opaque UUIDv4 identifier. */",
        "function requireDigest(value: unknown): string {": "/** Requires and canonicalizes one SHA-256 hexadecimal digest. */",
        "function requireTimestamp(value: unknown): string {": "/** Requires a valid date or RFC 3339 timestamp and normalizes it to UTC. */",
        "function validateContextItem(value: ProposalContextItem): ProposalContextItem {": "/** Revalidates one proposal context item before canonical hashing. */",
        "function validateRequest(value: unknown): ProposalRequest {": "/** Revalidates one proposal request and maps generator errors to audit validation. */",
        "function validateOperation(value: unknown): ProposalOperation {": "/** Revalidates one inert proposed operation for immutable evidence. */",
        "function validateProposal(value: unknown): AuditableProposal {": "/** Revalidates one immutable inert proposal and its bounded nested fields. */",
        "function canonicalOperation(\n": "/** Projects one validated operation into deterministic digest field order. */",
        "function digest(value: unknown): string {": "/** Computes a lowercase SHA-256 digest over canonical JSON evidence. */",
    }
    for marker, comment in comments.items():
        ensure_before(path, marker, comment)


def document_repository() -> None:
    """Document every PostgreSQL adapter row, helper, and repository operation."""
    path = "apps/ai-service/src/postgres-proposal-audit-repository.ts"
    replace_once(
        path,
        """export interface ProposalAuditSqlClient {
  query<Row>(
""",
        """export interface ProposalAuditSqlClient {
  /** Executes one parameterized SQL statement and returns bounded rows. */
  query<Row>(
""",
    )
    ensure_before(path, "interface ProposalAuditRow {", "/** Untrusted PostgreSQL row for one immutable proposal revision. */")
    ensure_before(path, "interface ProposalDecisionRow {", "/** Untrusted PostgreSQL row for one append-only proposal decision. */")
    ensure_before(path, "interface PostgreSqlErrorShape {", "/** Minimal PostgreSQL error classification used for named constraint mapping. */")
    replace_once(
        path,
        """export class ProposalAuditPersistenceError extends Error {
  constructor() {
""",
        """export class ProposalAuditPersistenceError extends Error {
  /** Creates a stable credential-free database failure. */
  constructor() {
""",
    )
    replace_once(
        path,
        """export class ProposalDecisionConflictError extends Error {
  constructor() {
""",
        """export class ProposalDecisionConflictError extends Error {
  /** Creates a stable conflict for non-identical idempotency replay. */
  constructor() {
""",
    )
    comments = {
        "function invalidPersistence(): never {": "/** Raises the shared credential-free persistence failure. */",
        "function requireUuidV4(value: unknown): string {": "/** Requires a canonical UUIDv4 at the SQL boundary. */",
        "function requireExpected(actual: string, expected: string): void {": "/** Verifies that a persisted identifier remains within the requested tenant scope. */",
        "function oneOrUndefined<Row>(rows: Row[]): Row | undefined {": "/** Accepts zero or one row and rejects impossible duplicate identities. */",
        "function exactlyOne<Row>(rows: Row[]): Row {": "/** Requires exactly one row for a successful state transition or replay. */",
        "function isNamedDatabaseError(\n": "/** Matches only one PostgreSQL code and reviewed constraint name. */",
        "function parseProposalRow(\n": "/** Validates and tenant-checks one untrusted proposal row. */",
        "function parseDecisionRow(\n": "/** Validates and tenant-checks one untrusted decision row. */",
        "function validateProposalInput(\n": "/** Maps malformed proposal input to the stable persistence error contract. */",
        "function validateDecisionInput(\n": "/** Maps malformed decision input to the stable persistence error contract. */",
        "function sameDecisionPayload(\n": "/** Compares every immutable decision field relevant to exact idempotent replay. */",
    }
    for marker, comment in comments.items():
        ensure_before(path, marker, comment)
    replace_once(
        path,
        """export class PostgresProposalAuditRepository implements ProposalAuditRepository {
  constructor(private readonly client: ProposalAuditSqlClient) {}

  private async query<Row>(
""",
        """export class PostgresProposalAuditRepository implements ProposalAuditRepository {
  /** Creates the repository over one bounded parameterized SQL client. */
  constructor(private readonly client: ProposalAuditSqlClient) {}

  /** Executes SQL while replacing transport details with one stable failure. */
  private async query<Row>(
""",
    )
    methods = {
        "  async saveProposal(record: ProposalAuditRecord): Promise<void> {": "  /** Persists one immutable tenant-scoped proposal revision. */",
        "  async findProposal(\n": "  /** Finds one tenant-scoped proposal revision with duplicate-row rejection. */",
        "  async listProposals(workspaceId: string): Promise<ProposalAuditRecord[]> {": "  /** Lists tenant proposal evidence in deterministic creation order. */",
        "  async appendDecision(\n": "  /** Appends one decision or returns an exact idempotent replay. */",
        "  async listDecisions(\n": "  /** Lists append-only tenant decision history in deterministic order. */",
    }
    for marker, comment in methods.items():
        ensure_before(path, marker, comment)


def document_application() -> None:
    """Document the remaining application-layer error constructor."""
    path = "apps/ai-service/src/proposal-audit-application.ts"
    replace_once(
        path,
        """export class ProposalAuditNotFoundError extends Error {
  constructor() {
""",
        """export class ProposalAuditNotFoundError extends Error {
  /** Creates a stable tenant-safe absence without disclosing another workspace. */
  constructor() {
""",
    )


def update_root_formatting() -> None:
    """Add every new deterministic source and document to the root formatting gate."""
    path = ROOT / "package.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    additions = [
        "apps/ai-service/vitest.config.ts",
        "apps/ai-service/src/docstring-coverage.test.ts",
        "docs/operations/ai-proposal-audit-assurance.md",
        "docs/superpowers/specs/2026-08-04-ai-service-quality-gates-design.md",
        "docs/superpowers/plans/2026-08-04-ai-service-quality-gates.md",
    ]
    command = data["scripts"]["format:check"]
    for item in additions:
        if item not in command:
            command += f" {item}"
    data["scripts"]["format:check"] = command
    write("package.json", json.dumps(data, indent=2))


def write_assurance_document() -> None:
    """Create the operator-facing AI proposal audit assurance and limitations note."""
    write(
        "docs/operations/ai-proposal-audit-assurance.md",
        """# AI proposal audit assurance

## Control objective

The AI service generates inert proposals, records immutable provenance before response, and appends explicit accept or reject decisions without receiving any capability to execute the proposed operations. The service can run independently or behind the LifeOS gateway through the same bounded HTTP and PostgreSQL contracts.

## Implemented assurance boundary

- Proposal requests, model drafts, identifiers, timestamps, and persisted rows are revalidated at their trust boundaries.
- Canonical SHA-256 request and content digests bind each proposal to its workspace, model identifier, evidence, output, and creation time.
- `ai.proposal_audit_records` and `ai.proposal_decision_events` are append-only PostgreSQL objects with multi-word `snake_case` identifiers.
- Decision writes require the exact immutable proposal content digest and a UUIDv4 idempotency key. Exact replay returns the original event; conflicting replay fails closed.
- Workspace and actor scope arrive only through trusted headers. Public deployment therefore requires an authenticated private gateway that strips caller-supplied ownership headers and derives them from a verified session.
- RFC 9457 problem responses expose stable codes without prompts, stack traces, SQL details, credentials, model output, or another tenant's existence.
- No route, command bus, generic repository, or adapter can apply or execute a proposal.

## Human authorization separation

`requiresConfirmation: true` is an explicit product invariant, not an execution permission. An accepted decision is audit evidence only. A future execution capability must be separately designed, authenticated, authorized, idempotent, reviewable, and connected to bounded domain commands. It must never infer execution authority from the mere presence of an accepted decision.

## Executable quality evidence

`apps/ai-service/vitest.config.ts` requires 100% statements, branches, functions, and lines across all production TypeScript. No production file or branch is excluded. `src/docstring-coverage.test.ts` uses the TypeScript compiler API to require JSDoc on production top-level declarations and class/interface members while excluding tests and nested callbacks.

The test suite includes deterministic unit evidence and real disposable-PostgreSQL/HTTP scenarios for restart durability, tenant isolation, exact decision replay, conflicting replay, stale revisions, append-only enforcement, lifecycle shutdown, pool failures, malformed rows, sanitized errors, and absence of execution routes.

Run the package assurance gate with:

```bash
AI_DATABASE_URL=postgresql://... \\
AI_TEST_DATABASE_URL=postgresql://... \\
pnpm --filter @life-os/ai-service test
```

The integration database must be disposable and its database name must contain `test`. The suite refuses to drop the `ai` schema otherwise.

## Continuous risk review triggers

Re-run architecture, security, privacy, evaluation, and operational review whenever any of the following changes:

- model or model-provider version;
- system prompt, rubric, tool schema, or output schema;
- evidence source, retrieval policy, or retention period;
- proposal operation vocabulary;
- authenticated gateway or ownership derivation;
- decision policy or future execution permission;
- telemetry attributes, incident response, or production deployment topology.

## Limitations

Append-only provenance improves traceability but does not prove model correctness, calibration, fairness, usefulness, copyright compliance, privacy compliance, or freedom from prompt injection. This slice uses the deterministic local rule-based adapter and therefore does not exercise NVIDIA NIM or any external model. External-model introduction requires provider-specific accuracy, robustness, privacy, cost, latency, and adversarial tests before release.

## References

Autio, C., Schwartz, R., Dunietz, J., Jain, S., Stanley, M., Tabassi, E., Hall, P., & Roberts, K. (2024). *Artificial intelligence risk management framework: Generative artificial intelligence profile* (NIST AI 600-1). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.AI.600-1

International Organization for Standardization. (2023a). *Information technology—Artificial intelligence—Guidance on risk management* (ISO/IEC 23894:2023). ISO.

International Organization for Standardization. (2023b). *Information technology—Artificial intelligence—Management system* (ISO/IEC 42001:2023). ISO.

Nottingham, M., Wilde, E., & Dalal, S. (2023). *Problem details for HTTP APIs* (RFC 9457). RFC Editor. https://doi.org/10.17487/RFC9457
""",
    )


def update_capability_manifest() -> None:
    """Add executable AI audit assurance evidence to the hourly product gap loop."""
    path = ROOT / "product/capabilities.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    capability_id = "quality.ai-audit-assurance"
    if not any(item["id"] == capability_id for item in data["capabilities"]):
        data["capabilities"].append(
            {
                "id": capability_id,
                "outcome": "Acquirers and operators can verify that the AI audit boundary is fully documented, exhaustively tested, and governed by current standards.",
                "target_maturity": "production",
                "customer_impact": 4,
                "risk": 5,
                "acquisition_impact": 5,
                "effort": 3,
                "dependencies": [
                    "ai.auditable-proposals",
                    "automation.commercial-readiness-loop",
                ],
                "tracking_issue": 107,
                "evidence": [
                    {
                        "maturity": "prototype",
                        "kind": "implementation",
                        "mode": "exists",
                        "path": "apps/ai-service/vitest.config.ts",
                    },
                    {
                        "maturity": "usable",
                        "kind": "test",
                        "mode": "exists",
                        "path": "apps/ai-service/src/docstring-coverage.test.ts",
                    },
                    {
                        "maturity": "production",
                        "kind": "test",
                        "mode": "contains",
                        "path": "apps/ai-service/vitest.config.ts",
                        "value": "statements: 100",
                    },
                    {
                        "maturity": "production",
                        "kind": "documentation",
                        "mode": "exists",
                        "path": "docs/operations/ai-proposal-audit-assurance.md",
                    },
                ],
            }
        )
    write("product/capabilities.json", json.dumps(data, indent=2))


def update_changelog() -> None:
    """Record the buyer-visible assurance gates and domain dependency correction."""
    path = "CHANGELOG.md"
    text = read(path)
    added = "- Executable AI-service JSDoc and exact 100% statement, branch, function, and line coverage gates, with an operator-facing governance assurance boundary."
    if added not in text:
        text = text.replace(
            "### Added\n\n",
            f"### Added\n\n{added}\n",
            1,
        )
    fixed = "- Stale AI proposal revision conflicts now belong to the technology-independent audit domain while the PostgreSQL adapter preserves its compatibility export."
    if fixed not in text:
        text = text.replace(
            "### Fixed\n\n",
            f"### Fixed\n\n{fixed}\n",
            1,
        )
    write(path, text)


def main() -> None:
    """Apply the complete reviewed assurance slice idempotently."""
    document_runtime()
    document_proposal_service()
    move_stale_revision_error()
    document_audit_domain()
    document_repository()
    document_application()
    update_root_formatting()
    write_assurance_document()
    update_capability_manifest()
    update_changelog()


if __name__ == "__main__":
    main()
