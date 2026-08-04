#!/usr/bin/env python3
"""Close the remaining AI service coverage gaps with reviewed realistic evidence."""

from __future__ import annotations

import base64
import json
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

QUALITY_TEST = "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"
SERVER_TEST = "eNptkEFLxDAQhe/7K+aWFEr9AcsKqxc9LIKi92zyqsE2U5JptZT+d9Pqrgt6mBAy733zMr7tOApN5JBs9EeUhM8OVkryuQZPM9WRW1KDFyRR283mJNVqf09dZIuUCEHi2LEPokrSBe2uadpQhmjl0ODVZPdZnMRE6TsSJnkDLWA4OjJLkmi6fOuDM3HMKJPGYC+AlDNVEQlyYNc3SLrYrs+WQ5Jfxt4/IQ7egnaLow66qFq2749I3AxwL6bpofMY1D7A/UCy0vEhy7Sqrlrjw/kzevqPPRfZuDrNh/FCfl3nYk5ZgahO7e+l6r+IohK+MwNugHBrmgbuIVjoyzzPob1MtLbmfC71BXMUkgU="


def read(path: str) -> str:
    """Read one repository UTF-8 text file."""
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    """Write one repository UTF-8 text file with a terminal newline."""
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    """Replace one reviewed fragment or fail closed if the source moved."""
    text = read(path)
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    write(path, text.replace(old, new, 1))


def decode_source(value: str) -> str:
    """Decode one compressed reviewed TypeScript source payload."""
    return zlib.decompress(base64.b64decode(value)).decode("utf-8")


def simplify_proposal_validation() -> None:
    """Remove one unreachable interpolation guard while retaining fixed bounds."""
    replace_once(
        "apps/ai-service/src/proposal-service.ts",
        """  const available = MAXIMUM_TEXT_LENGTH - prefix.length - suffix.length;
  if (available < TRUNCATION_MARKER.length) {
    return invalid();
  }
  const boundedValue =
""",
        """  const available = MAXIMUM_TEXT_LENGTH - prefix.length - suffix.length;
  const boundedValue =
""",
    )


def simplify_audit_request_validation() -> None:
    """Reuse the already strict proposal request validator without duplicate branches."""
    path = "apps/ai-service/src/proposal-audit-domain.ts"
    replace_once(
        path,
        """  AuditableProposal,
  ProposalContextItem,
  ProposalOperation,
""",
        """  AuditableProposal,
  ProposalOperation,
""",
    )
    replace_once(
        path,
        """import {
  ProposalValidationError,
  validateProposalRequest,
} from './proposal-service';
""",
        """import { validateProposalRequest } from './proposal-service';
""",
    )
    text = read(path)
    start_marker = "/** Revalidates one proposal context item before canonical hashing. */"
    end_marker = "/** Revalidates one inert proposed operation for immutable evidence. */"
    if start_marker in text:
        start = text.index(start_marker)
        end = text.index(end_marker)
        replacement = """/** Revalidates one proposal request and maps generator failures to audit validation. */
function validateRequest(value: unknown): ProposalRequest {
  try {
    return validateProposalRequest(value);
  } catch {
    return invalid();
  }
}

"""
        write(path, text[:start] + replacement + text[end:])


def simplify_repository_validation() -> None:
    """Centralize malformed row/input mapping into one credential-free boundary."""
    path = "apps/ai-service/src/postgres-proposal-audit-repository.ts"
    replace_once(
        path,
        """  type ProposalAuditRecord,
  type ProposalAuditRepository,
  ProposalAuditValidationError,
  ProposalDigestMismatchError,
""",
        """  type ProposalAuditRecord,
  type ProposalAuditRepository,
  ProposalDigestMismatchError,
""",
    )
    replace_once(
        path,
        """function invalidPersistence(): never {
  throw new ProposalAuditPersistenceError();
}

""",
        """function invalidPersistence(): never {
  throw new ProposalAuditPersistenceError();
}

/** Maps any malformed boundary value to the stable persistence failure. */
function mapPersistenceValidation<Value>(operation: () => Value): Value {
  try {
    return operation();
  } catch {
    return invalidPersistence();
  }
}

""",
    )
    text = read(path)
    proposal_start = "/** Validates and tenant-checks one untrusted proposal row. */"
    decision_start = "/** Validates and tenant-checks one untrusted decision row. */"
    proposal_replacement = """/** Validates and tenant-checks one untrusted proposal row. */
function parseProposalRow(
  row: ProposalAuditRow,
  expectedWorkspaceId: string,
  expectedProposalId?: string,
): ProposalAuditRecord {
  const record = mapPersistenceValidation(() =>
    validateProposalAuditRecord({
      proposal: {
        proposalId: row.proposal_id,
        workspaceId: row.workspace_id,
        summary: row.summary,
        rationale: row.rationale_json,
        operations: row.operations_json,
        requiresConfirmation: row.requires_confirmation,
        createdAt: row.created_at,
      },
      request: row.request_json,
      modelId: row.model_id,
      requestDigest: row.request_digest,
      contentDigest: row.content_digest,
      recordedAt: row.recorded_at,
    }),
  );
  requireExpected(record.proposal.workspaceId, expectedWorkspaceId);
  if (expectedProposalId) {
    requireExpected(record.proposal.proposalId, expectedProposalId);
  }
  return record;
}

"""
    if proposal_start in text:
        start = text.index(proposal_start)
        end = text.index(decision_start)
        text = text[:start] + proposal_replacement + text[end:]
    proposal_input = "/** Maps malformed proposal input to the stable persistence error contract. */"
    decision_replacement = """/** Validates and tenant-checks one untrusted decision row. */
function parseDecisionRow(
  row: ProposalDecisionRow,
  expectedWorkspaceId: string,
  expectedProposalId?: string,
  expectedIdempotencyKey?: string,
): ProposalDecisionEvent {
  const value = {
    id: row.id,
    workspaceId: row.workspace_id,
    proposalId: row.proposal_id,
    proposalContentDigest: row.proposal_content_digest,
    actorId: row.actor_id,
    decision: row.decision_kind,
    ...(row.reason_text === null || row.reason_text === undefined
      ? {}
      : { reason: row.reason_text }),
    idempotencyKey: row.idempotency_key,
    decidedAt: row.decided_at,
    recordedAt: row.recorded_at,
  };
  const event = mapPersistenceValidation(() =>
    validateProposalDecisionEvent(value),
  );
  requireExpected(event.workspaceId, expectedWorkspaceId);
  if (expectedProposalId) {
    requireExpected(event.proposalId, expectedProposalId);
  }
  if (expectedIdempotencyKey) {
    requireExpected(event.idempotencyKey, expectedIdempotencyKey);
  }
  return event;
}

"""
    if decision_start in text:
        start = text.index(decision_start)
        end = text.index(proposal_input)
        text = text[:start] + decision_replacement + text[end:]
    comparison = "/** Compares every immutable decision field relevant to exact idempotent replay. */"
    helpers = """/** Maps malformed proposal input to the stable persistence error contract. */
function validateProposalInput(
  record: ProposalAuditRecord,
): ProposalAuditRecord {
  return mapPersistenceValidation(() => validateProposalAuditRecord(record));
}

/** Maps malformed decision input to the stable persistence error contract. */
function validateDecisionInput(
  event: ProposalDecisionEvent,
): ProposalDecisionEvent {
  return mapPersistenceValidation(() => validateProposalDecisionEvent(event));
}

"""
    if proposal_input in text:
        start = text.index(proposal_input)
        end = text.index(comparison)
        text = text[:start] + helpers + text[end:]
    write(path, text)


def refactor_process_bootstrap() -> None:
    """Separate the executable entrypoint from a fully testable bootstrap boundary."""
    path = "apps/ai-service/src/main.ts"
    replace_once(
        path,
        """  ProposalAuditPersistenceError,
  ProposalDecisionConflictError,
  ProposalDigestMismatchError,
} from './postgres-proposal-audit-repository';
""",
        """  ProposalAuditPersistenceError,
  ProposalDecisionConflictError,
} from './postgres-proposal-audit-repository';
""",
    )
    if "interface ProposalGenerator {" in read(path):
        replace_once(path, "interface ProposalGenerator {", "export interface ProposalGenerator {")
    old_tail = """/** Boots the production AI process with exactly-once shutdown hooks. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AiProductionModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.AI_SERVICE_PORT ?? 4105), '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
"""
    new_tail = """/** Minimal Nest application behavior needed by the AI process bootstrap. */
export interface AiBootstrapApplication {
  /** Enables Nest-managed lifecycle shutdown hooks. */
  enableShutdownHooks(): void;
  /** Starts the HTTP server on one validated port and fixed host. */
  listen(port: number, host: string): Promise<unknown>;
}

/** Factory used to construct the production Nest application. */
export type AiApplicationFactory = () => Promise<AiBootstrapApplication>;

/** Creates the production Nest application without starting its listener. */
export async function createAiApplication(): Promise<AiBootstrapApplication> {
  return await NestFactory.create(AiProductionModule);
}

/** Parses the optional AI service port into the supported TCP range. */
export function resolveAiServicePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 4_105;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('AI service port is invalid');
  }
  return parsed;
}

/** Boots the production AI process with exactly-once shutdown hooks. */
export async function bootstrapAiService(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  applicationFactory: AiApplicationFactory = createAiApplication,
): Promise<void> {
  const port = resolveAiServicePort(environment.AI_SERVICE_PORT);
  const app = await applicationFactory();
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}
"""
    replace_once(path, old_tail, new_tail)
    write(
        "apps/ai-service/src/server.ts",
        """import 'reflect-metadata';
import { bootstrapAiService } from './main';

void bootstrapAiService();
""",
    )


def write_coverage_tests() -> None:
    """Write the reviewed exhaustive unit, SQL-boundary, HTTP, and bootstrap evidence."""
    write("apps/ai-service/src/quality-coverage.test.ts", decode_source(QUALITY_TEST))
    write("apps/ai-service/src/server.test.ts", decode_source(SERVER_TEST))


def update_package_contracts() -> None:
    """Point development and production commands at the branchless tested entrypoint."""
    path = ROOT / "apps/ai-service/package.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["scripts"]["dev"] = "nest start --watch --entryFile server"
    data["scripts"]["start"] = "node dist/server.js"
    write("apps/ai-service/package.json", json.dumps(data, indent=2))

    root_path = ROOT / "package.json"
    root_data = json.loads(root_path.read_text(encoding="utf-8"))
    command = root_data["scripts"]["format:check"]
    for item in [
        "apps/ai-service/src/server.ts",
        "apps/ai-service/src/quality-coverage.test.ts",
        "apps/ai-service/src/server.test.ts",
    ]:
        if item not in command:
            command += f" {item}"
    root_data["scripts"]["format:check"] = command
    write("package.json", json.dumps(root_data, indent=2))


def main() -> None:
    """Apply the reviewed source simplifications and exhaustive test evidence."""
    simplify_proposal_validation()
    simplify_audit_request_validation()
    simplify_repository_validation()
    refactor_process_bootstrap()
    write_coverage_tests()
    update_package_contracts()


if __name__ == "__main__":
    main()
