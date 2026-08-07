"""Apply deterministic, test-first corrections to the privacy service."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PRIVACY = ROOT / "apps/privacy-service"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    """Replace one exact source block or stop before ambiguous mutation."""

    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def replace_all(
    path: Path,
    old: str,
    new: str,
    label: str,
    minimum: int = 1,
) -> None:
    """Replace every matching fixture while requiring meaningful coverage."""

    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count < minimum:
        raise SystemExit(f"{label}: expected at least {minimum} matches, found {count}")
    path.write_text(source.replace(old, new), encoding="utf-8")


def repair_context_headers() -> None:
    """Make the exact signed headers structurally compatible with the verifier."""

    path = PRIVACY / "src/privacy-service-context.ts"
    replace_once(
        path,
        """export interface PrivacyServiceContextHeaders {
  readonly 'x-life-os-context-key-id': string;
""",
        """export interface PrivacyServiceContextHeaders {
  readonly [headerName: string]: string;
  readonly 'x-life-os-context-key-id': string;
""",
        "privacy context header index signature",
    )


def repair_application_initialization() -> None:
    """Let strict property initialization observe the constructor's never path."""

    path = PRIVACY / "src/privacy-access-application.ts"
    replace_once(
        path,
        """    if (!dependencies || typeof dependencies !== 'object') {
      return invalid();
    }
""",
        """    if (!dependencies || typeof dependencies !== 'object') {
      invalid();
    }
""",
        "privacy application constructor guard",
    )


def repair_policy_typing() -> None:
    """Contextually type the immutable purpose matrix as reviewed policy rules."""

    path = PRIVACY / "src/privacy-access-domain.ts"
    source = path.read_text(encoding="utf-8")
    source = source.replace(
        "const POLICY_RULES = Object.freeze([",
        "const POLICY_RULES: readonly PolicyRule[] = Object.freeze([",
        1,
    )
    for old, new in (
        ("Object.freeze(['read', 'correct'])", "Object.freeze(['read', 'correct'] as const)"),
        ("Object.freeze(['read'])", "Object.freeze(['read'] as const)"),
        ("Object.freeze(['read', 'export'])", "Object.freeze(['read', 'export'] as const)"),
        ("Object.freeze(['identity_profile'])", "Object.freeze(['identity_profile'] as const)"),
    ):
        source = source.replace(old, new)
    investigation_categories = """    resourceCategories: Object.freeze([
      'identity_profile',
      'notification_content',
      'ai_audit_content',
    ]),
"""
    typed_investigation_categories = """    resourceCategories: Object.freeze([
      'identity_profile',
      'notification_content',
      'ai_audit_content',
    ] as const),
"""
    if source.count(investigation_categories) != 1:
        raise SystemExit(
            "privacy investigation category matrix: expected one match"
        )
    source = source.replace(
        investigation_categories,
        typed_investigation_categories,
        1,
    )
    path.write_text(source, encoding="utf-8")


def repair_pg_adapter() -> None:
    """Keep the generic repository seam while adapting node-postgres rows safely."""

    path = PRIVACY / "src/privacy-runtime.ts"
    replace_once(
        path,
        """    const result = await this.client.query<Row>(
      text,
      values === undefined ? undefined : [...values],
    );
    return { rows: result.rows };
""",
        """    const result = await this.client.query(
      text,
      values === undefined ? undefined : [...values],
    );
    return { rows: result.rows as Row[] };
""",
        "node-postgres generic adapter",
    )


def repair_lint_contract() -> None:
    """Keep SQL validated by migration tests rather than an unsupported formatter."""

    path = PRIVACY / "package.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    document["scripts"]["lint"] = document["scripts"]["lint"].replace(
        ' migrations/*.sql',
        "",
    )
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def add_authorized_purpose_tests() -> None:
    """Define regression evidence for signed-purpose privilege boundaries first."""

    context_tests = PRIVACY / "src/privacy-service-context.test.ts"
    replace_all(
        context_tests,
        """        actorId: ACTOR_ID,
        method:""",
        """        actorId: ACTOR_ID,
        authorizedPurpose: 'workspace_operation',
        method:""",
        "context signing purpose fixtures",
        minimum=5,
    )
    replace_all(
        context_tests,
        """      'x-life-os-actor-id': ACTOR_ID,
""",
        """      'x-life-os-actor-id': ACTOR_ID,
      'x-life-os-authorized-purpose': 'workspace_operation',
""",
        "context expected purpose headers",
        minimum=2,
    )
    replace_all(
        context_tests,
        ".toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });",
        """.toEqual({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      authorizedPurpose: 'workspace_operation',
    });""",
        "context verified purpose outputs",
        minimum=2,
    )
    replace_once(
        context_tests,
        """      { ...headers, 'x-life-os-context-signature': 'forged' },
      { ...headers, 'x-life-os-context-key-id': 'retired-key' },
""",
        """      { ...headers, 'x-life-os-context-signature': 'forged' },
      { ...headers, 'x-life-os-authorized-purpose': 'root_access' },
      { ...headers, 'x-life-os-context-key-id': 'retired-key' },
""",
        "context forged purpose case",
    )
    replace_once(
        context_tests,
        """    { actorId: 'numeric-2' },
    { method: 'POST\\nGET' },
""",
        """    { actorId: 'numeric-2' },
    { authorizedPurpose: 'root_access' },
    { method: 'POST\\nGET' },
""",
        "context invalid signing purpose",
    )

    coverage_tests = PRIVACY / "src/privacy-service-context-coverage.test.ts"
    replace_all(
        coverage_tests,
        """      actorId: ACTOR_ID,
      method:""",
        """      actorId: ACTOR_ID,
      authorizedPurpose: 'workspace_operation',
      method:""",
        "context coverage purpose fixtures",
        minimum=3,
    )
    replace_all(
        coverage_tests,
        ".toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });",
        """.toEqual({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      authorizedPurpose: 'workspace_operation',
    });""",
        "context coverage purpose outputs",
        minimum=2,
    )

    boundary_tests = PRIVACY / "src/privacy-http-boundary.test.ts"
    replace_all(
        boundary_tests,
        """        'x-life-os-actor-id': ACTOR_ID,
""",
        """        'x-life-os-actor-id': ACTOR_ID,
        'x-life-os-authorized-purpose': 'workspace_operation',
""",
        "HTTP input purpose headers",
        minimum=3,
    )
    replace_all(
        boundary_tests,
        """      'x-life-os-actor-id': ACTOR_ID,
""",
        """      'x-life-os-actor-id': ACTOR_ID,
      'x-life-os-authorized-purpose': 'workspace_operation',
""",
        "HTTP expected purpose headers",
        minimum=1,
    )

    main_tests = PRIVACY / "src/main.test.ts"
    replace_once(
        main_tests,
        """import type { PrivacyAccessDecision } from './privacy-access-domain';
""",
        """import type {
  PrivacyAccessDecision,
  PrivacyAccessPurpose,
} from './privacy-access-domain';
""",
        "controller purpose type import",
    )
    replace_once(
        main_tests,
        """function headers(path: string): Record<string, string> {
""",
        """function headers(
  path: string,
  authorizedPurpose: PrivacyAccessPurpose = 'workspace_operation',
): Record<string, string> {
""",
        "controller signed purpose helper",
    )
    replace_once(
        main_tests,
        """        actorId: ACTOR_ID,
        method: 'POST',
""",
        """        actorId: ACTOR_ID,
        authorizedPurpose,
        method: 'POST',
""",
        "controller signed purpose fixture",
    )
    replace_once(
        main_tests,
        """  it('returns a bounded 403 receipt after persisting a denied decision', async () => {
""",
        """  it('rejects body-purpose escalation before the application boundary', async () => {
    const fixture = operations({
      decision: decision('allowed'),
      grantToken: 'a.b',
    });
    const controller = new PrivacyController(
      fixture.boundary,
      keyRing(),
      () => NOW,
    );
    await expect(
      controller.decide(
        headers('/v1/privacy/access-decisions', 'account_support'),
        {
          purpose: 'workspace_operation',
          action: 'read',
          resourceCategory: 'planning_content',
          requestedTtlSeconds: 600,
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(fixture.decide).not.toHaveBeenCalled();
  });

  it('returns a bounded 403 receipt after persisting a denied decision', async () => {
""",
        "controller purpose escalation regression",
    )


def add_authorized_purpose_implementation() -> None:
    """Bind every decision purpose to one gateway-authorized signed value."""

    context = PRIVACY / "src/privacy-service-context.ts"
    replace_once(
        context,
        """import { createHmac, timingSafeEqual } from 'node:crypto';
""",
        """import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PRIVACY_ACCESS_PURPOSES,
  type PrivacyAccessPurpose,
} from './privacy-access-domain';
""",
        "context purpose imports",
    )
    replace_once(
        context,
        """  'x-life-os-actor-id',
  'x-life-os-context-issued-at',
""",
        """  'x-life-os-actor-id',
  'x-life-os-authorized-purpose',
  'x-life-os-context-issued-at',
""",
        "context expected purpose header",
    )
    replace_once(
        context,
        """  readonly actorId: string;
  readonly method: string;
""",
        """  readonly actorId: string;
  readonly authorizedPurpose: PrivacyAccessPurpose;
  readonly method: string;
""",
        "context signing purpose input",
    )
    replace_once(
        context,
        """  readonly 'x-life-os-actor-id': string;
  readonly 'x-life-os-context-issued-at': string;
""",
        """  readonly 'x-life-os-actor-id': string;
  readonly 'x-life-os-authorized-purpose': PrivacyAccessPurpose;
  readonly 'x-life-os-context-issued-at': string;
""",
        "context purpose header type",
    )
    replace_once(
        context,
        """export interface VerifiedPrivacyServiceContext {
  readonly workspaceId: string;
  readonly actorId: string;
}
""",
        """export interface VerifiedPrivacyServiceContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly authorizedPurpose: PrivacyAccessPurpose;
}
""",
        "verified context purpose",
    )
    replace_once(
        context,
        """function requireMethod(value: unknown): string {
""",
        """function requireAuthorizedPurpose(value: unknown): PrivacyAccessPurpose {
  return typeof value === 'string' &&
    (PRIVACY_ACCESS_PURPOSES as readonly string[]).includes(value)
    ? (value as PrivacyAccessPurpose)
    : invalid();
}

function requireMethod(value: unknown): string {
""",
        "context purpose validator",
    )
    replace_once(
        context,
        """  actorId: string;
  issuedAtSeconds: number;
""",
        """  actorId: string;
  authorizedPurpose: PrivacyAccessPurpose;
  issuedAtSeconds: number;
""",
        "context canonical purpose type",
    )
    replace_once(
        context,
        """    input.actorId,
    String(input.issuedAtSeconds),
""",
        """    input.actorId,
    input.authorizedPurpose,
    String(input.issuedAtSeconds),
""",
        "context canonical purpose value",
    )
    replace_once(
        context,
        """  const actorId = requireUuid(input.actorId);
  const method = requireMethod(input.method);
""",
        """  const actorId = requireUuid(input.actorId);
  const authorizedPurpose = requireAuthorizedPurpose(input.authorizedPurpose);
  const method = requireMethod(input.method);
""",
        "context signing purpose validation",
    )
    replace_once(
        context,
        """    actorId,
    issuedAtSeconds,
""",
        """    actorId,
    authorizedPurpose,
    issuedAtSeconds,
""",
        "context signing canonical purpose",
    )
    replace_once(
        context,
        """    'x-life-os-actor-id': actorId,
    'x-life-os-context-issued-at': String(issuedAtSeconds),
""",
        """    'x-life-os-actor-id': actorId,
    'x-life-os-authorized-purpose': authorizedPurpose,
    'x-life-os-context-issued-at': String(issuedAtSeconds),
""",
        "context emitted purpose header",
    )
    replace_once(
        context,
        """  const actorId = requireUuid(header(headers, 'x-life-os-actor-id'));
  const issuedAtText = header(headers, 'x-life-os-context-issued-at');
""",
        """  const actorId = requireUuid(header(headers, 'x-life-os-actor-id'));
  const authorizedPurpose = requireAuthorizedPurpose(
    header(headers, 'x-life-os-authorized-purpose'),
  );
  const issuedAtText = header(headers, 'x-life-os-context-issued-at');
""",
        "context verified purpose header",
    )
    replace_once(
        context,
        """    actorId,
    issuedAtSeconds,
    method,
""",
        """    actorId,
    authorizedPurpose,
    issuedAtSeconds,
    method,
""",
        "context verification canonical purpose",
    )
    replace_once(
        context,
        """  return Object.freeze({ workspaceId, actorId });
""",
        """  return Object.freeze({ workspaceId, actorId, authorizedPurpose });
""",
        "context verified purpose output",
    )

    boundary = PRIVACY / "src/privacy-http-boundary.ts"
    replace_once(
        boundary,
        """  'x-life-os-actor-id',
  'x-life-os-context-issued-at',
""",
        """  'x-life-os-actor-id',
  'x-life-os-authorized-purpose',
  'x-life-os-context-issued-at',
""",
        "HTTP selected purpose header",
    )

    main = PRIVACY / "src/main.ts"
    replace_once(
        main,
        """  deniedPrivacyDecisionException,
  extractPrivacyServiceContextHeaders,
""",
        """  PrivacyHttpValidationError,
  deniedPrivacyDecisionException,
  extractPrivacyServiceContextHeaders,
""",
        "controller purpose mismatch error import",
    )
    replace_once(
        main,
        """      const request = parsePrivacyAccessDecisionBody(body);
      const result = await this.application.decide({
        ...context,
        ...request,
      });
""",
        """      const request = parsePrivacyAccessDecisionBody(body);
      if (request.purpose !== context.authorizedPurpose) {
        throw new PrivacyHttpValidationError();
      }
      const result = await this.application.decide({
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        ...request,
      });
""",
        "controller signed purpose enforcement",
    )
    replace_once(
        main,
        """      return await this.application.consume({
        ...context,
        ...request,
      });
""",
        """      return await this.application.consume({
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        ...request,
      });
""",
        "controller bounded consume context projection",
    )


def update_authorized_purpose_documentation() -> None:
    """Document the trusted gateway's exact signed-purpose obligation."""

    runbook = ROOT / "docs/operations/purpose-bound-pii-access.md"
    replace_once(
        runbook,
        """- the actor and workspace were authenticated by the trusted service boundary;
""",
        """- the actor, workspace, and exact requested purpose were authenticated and authorized by the trusted service boundary;
""",
        "runbook signed purpose objective",
    )
    replace_once(
        runbook,
        """3. Authorize workspace membership before contacting privacy-service.
4. Sign the exact HTTP method and `/v1/...` path with a short-lived private context.
5. Request the narrow purpose/action/resource-category combination.
""",
        """3. Authorize workspace membership and the actor's entitlement to one exact privacy purpose.
4. Sign the exact authorized purpose, HTTP method, and `/v1/...` path with a short-lived private context.
5. Send the same purpose in the bounded body with the narrow action/resource-category combination; any mismatch fails closed before policy evaluation.
""",
        "runbook signed purpose flow",
    )
    replace_once(
        runbook,
        """The privacy service must not receive direct public ingress. Only an authenticated gateway or an explicitly authorized internal workload may sign the private context headers.
""",
        """The privacy service must not receive direct public ingress. Only an authenticated gateway or an explicitly authorized internal workload may sign the private context headers, and it must sign a purpose only after role, entitlement, and workspace checks authorize that purpose for the actor.
""",
        "runbook gateway authorization contract",
    )

    design = ROOT / "docs/superpowers/specs/2026-08-07-purpose-bound-pii-access-design.md"
    replace_once(
        design,
        """    Consumer->>Privacy: Signed context + purpose/action/resource category
""",
        """    Consumer->>Privacy: Signed actor/workspace/authorized purpose + action/resource
""",
        "design signed purpose sequence",
    )
    replace_once(
        design,
        """- actor UUIDv4;
- method and path;
""",
        """- actor UUIDv4;
- one exact purpose authorized by upstream role and entitlement checks;
- method and path;
""",
        "design trusted purpose input",
    )
    replace_once(
        design,
        """JSON bodies cannot override ownership. The privacy-service signing secret, grant-token key ring, browser cookies, OAuth tokens, and provider credentials are server-only.
""",
        """JSON bodies cannot override ownership or elevate purpose. The body purpose must exactly match the HMAC-signed authorized-purpose header before policy evaluation. The privacy-service signing secret, grant-token key ring, browser cookies, OAuth tokens, and provider credentials are server-only.
""",
        "design body purpose boundary",
    )
    replace_once(
        design,
        """- forged, truncated, malformed, future-dated, expired, cross-tenant, cross-actor, and stale-policy tokens;
""",
        """- forged, truncated, malformed, future-dated, expired, cross-tenant, cross-actor, purpose-escalation, and stale-policy tokens;
""",
        "design purpose escalation test evidence",
    )


def prepare_compose_environment() -> None:
    """Create ignored deterministic key material for Compose validation only."""

    environment_path = ROOT / ".env"
    local_database_url = (
        "postgresql://" + "postgres" + ":" + "postgres" + "@127.0.0.1:5432/"
        + "life_os_privacy_test"
    )
    values = {
        "PRIVACY_DATABASE_URL": local_database_url,
        "PRIVACY_GRANT_ACTIVE_KEY_ID": "privacy-finalizer-grant",
        "PRIVACY_GRANT_ACTIVE_KEY_SECRET": "g" * 40,
        "PRIVACY_CONTEXT_ACTIVE_KEY_ID": "privacy-finalizer-context",
        "PRIVACY_CONTEXT_ACTIVE_KEY_SECRET": "c" * 40,
        "PRIVACY_AUDIT_DIGEST_KEY": "a" * 40,
    }
    environment_path.write_text(
        "".join(f"{name}={value}\n" for name, value in values.items()),
        encoding="utf-8",
    )
    environment_path.chmod(0o600)
    exclude_path = ROOT / ".git/info/exclude"
    exclude = exclude_path.read_text(encoding="utf-8")
    if ".env\n" not in exclude:
        exclude_path.write_text(exclude + "\n.env\n", encoding="utf-8")


def apply_implementation() -> None:
    """Apply production, type, documentation, and local verification fixes."""

    repair_context_headers()
    repair_application_initialization()
    repair_policy_typing()
    repair_pg_adapter()
    repair_lint_contract()
    add_authorized_purpose_implementation()
    update_authorized_purpose_documentation()
    prepare_compose_environment()


def main() -> None:
    """Apply the requested test-first finalization phase."""

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "phase",
        choices=("tests", "implementation", "all"),
        nargs="?",
        default="all",
    )
    phase = parser.parse_args().phase
    if phase in {"tests", "all"}:
        add_authorized_purpose_tests()
    if phase in {"implementation", "all"}:
        apply_implementation()


if __name__ == "__main__":
    main()
