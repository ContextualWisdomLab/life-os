"""Finalize permanent OpenCode maintenance policy, evidence, and formatting."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    """Read one repository file as UTF-8 text."""

    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    """Write one repository file as UTF-8 text."""

    (ROOT / path).write_text(content, encoding="utf-8")


def harden_model_boundary() -> None:
    """Remove model GitHub credentials and enforce review-agent integrity."""

    workflow_path = ".github/workflows/opencode-nim-maintenance.yml"
    workflow = read(workflow_path)
    workflow = workflow.replace(
        "          GITHUB_TOKEN: ${{ github.token }}\n",
        "",
    )
    workflow = workflow.replace(
        "          use_github_token: 'true'",
        "          use_github_token: 'false'",
    )
    setup_marker = "      - name: Set up Node.js\n"
    verifier_step = """      - name: Verify independent review-agent integrity
        run: |
          node <<'NODE'
          const { createHash } = require('node:crypto');
          const { readFileSync } = require('node:fs');
          const manifest = JSON.parse(
            readFileSync('product/review-agent-integrity.json', 'utf8'),
          );
          const hash = createHash('sha256');
          hash.update('life-os.review-agent-integrity.v1\\0');
          for (const path of [...manifest.workflowPaths].sort()) {
            hash.update(`workflow\\0${path}\\0`);
            hash.update(readFileSync(path));
            hash.update('\\0');
          }
          for (const secretName of [...manifest.secretNames].sort()) {
            hash.update(`secret\\0${secretName}\\0`);
          }
          if (hash.digest('hex') !== manifest.digest) {
            throw new Error('Independent review-agent integrity check failed');
          }
          NODE

"""
    if verifier_step not in workflow:
        if setup_marker not in workflow:
            raise SystemExit("OpenCode workflow setup marker is missing")
        workflow = workflow.replace(setup_marker, verifier_step + setup_marker, 1)
    write(workflow_path, workflow)


def update_workflow_contract_test() -> None:
    """Add executable assertions for model and review-agent isolation."""

    path = "packages/maintenance-agent/src/workflow-contract.test.mjs"
    source = read(path)
    if "import { createHash } from 'node:crypto';" not in source:
        source = source.replace(
            "import assert from 'node:assert/strict';\n",
            "import assert from 'node:assert/strict';\n"
            "import { createHash } from 'node:crypto';\n",
            1,
        )

    helper_marker = "function step(name) {\n"
    helper = """function reviewAgentDigest() {
  const hash = createHash('sha256');
  hash.update('life-os.review-agent-integrity.v1\\0');
  const contents = new Map([
    ['.github/workflows/appguardrail.yml', reviewWorkflow],
  ]);
  for (const path of [...fingerprint.workflowPaths].sort()) {
    hash.update(`workflow\\0${path}\\0`);
    hash.update(contents.get(path) ?? '');
    hash.update('\\0');
  }
  for (const secretName of [...fingerprint.secretNames].sort()) {
    hash.update(`secret\\0${secretName}\\0`);
  }
  return hash.digest('hex');
}

"""
    if helper not in source:
        if helper_marker not in source:
            raise SystemExit("Workflow test helper marker is missing")
        source = source.replace(helper_marker, helper + helper_marker, 1)

    model_assertion = "    assert.match(model, /share: 'false'/u);\n"
    if "use_github_token: 'false'" not in source:
        if model_assertion not in source:
            raise SystemExit("OpenCode model assertion marker is missing")
        source = source.replace(
            model_assertion,
            model_assertion
            + "    assert.match(model, /use_github_token: 'false'/u);\n"
            + "    assert.equal(model.includes('GITHUB_TOKEN'), false);\n",
            1,
        )

    digest_assertion = (
        "    assert.match(fingerprint.digest, /^[0-9a-f]{64}$/u);\n"
    )
    exact_assertion = "    assert.equal(fingerprint.digest, reviewAgentDigest());\n"
    if exact_assertion not in source:
        if digest_assertion not in source:
            raise SystemExit("Reviewer digest assertion marker is missing")
        source = source.replace(
            digest_assertion,
            digest_assertion
            + exact_assertion
            + "    assert.match(\n"
            + "      step('Verify independent review-agent integrity'),\n"
            + "      /life-os\\.review-agent-integrity\\.v1/u,\n"
            + "    );\n",
            1,
        )
    write(path, source)


def update_review_agent_digest() -> None:
    """Bind the fingerprint to exact reviewed workflow bytes and secret names."""

    path = ROOT / "product/review-agent-integrity.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    digest = hashlib.sha256()
    digest.update(b"life-os.review-agent-integrity.v1\0")
    for workflow_path in sorted(manifest["workflowPaths"]):
        digest.update(b"workflow\0")
        digest.update(workflow_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update((ROOT / workflow_path).read_bytes())
        digest.update(b"\0")
    for secret_name in sorted(manifest["secretNames"]):
        digest.update(b"secret\0")
        digest.update(secret_name.encode("utf-8"))
        digest.update(b"\0")
    manifest["digest"] = digest.hexdigest()
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def register_capability() -> None:
    """Register the independently testable automation capability."""

    path = ROOT / "product/capabilities.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    capability_id = "automation.opencode-maintenance"
    if not any(
        capability["id"] == capability_id
        for capability in document["capabilities"]
    ):
        commercial_index = next(
            index
            for index, capability in enumerate(document["capabilities"])
            if capability["id"] == "automation.commercial-readiness-loop"
        )
        document["capabilities"].insert(
            commercial_index + 1,
            {
                "id": capability_id,
                "outcome": (
                    "An hourly NVIDIA NIM OpenCode planner diagnoses reviewed "
                    "repository evidence without receiving merge authority."
                ),
                "target_maturity": "production",
                "customer_impact": 4,
                "risk": 5,
                "acquisition_impact": 5,
                "effort": 4,
                "dependencies": [
                    "automation.commercial-readiness-loop",
                    "security.appguardrail-gate",
                ],
                "tracking_issue": 119,
                "evidence": [
                    {
                        "maturity": "prototype",
                        "kind": "implementation",
                        "mode": "exists",
                        "path": "packages/maintenance-agent/src/contract.mjs",
                    },
                    {
                        "maturity": "usable",
                        "kind": "implementation",
                        "mode": "exists",
                        "path": "packages/maintenance-agent/src/plan.mjs",
                    },
                    {
                        "maturity": "usable",
                        "kind": "workflow",
                        "mode": "exists",
                        "path": ".github/workflows/opencode-nim-maintenance.yml",
                    },
                    {
                        "maturity": "production",
                        "kind": "test",
                        "mode": "exists",
                        "path": (
                            "packages/maintenance-agent/src/"
                            "workflow-contract.test.mjs"
                        ),
                    },
                    {
                        "maturity": "production",
                        "kind": "test",
                        "mode": "exists",
                        "path": "packages/maintenance-agent/src/fixture.test.mjs",
                    },
                    {
                        "maturity": "production",
                        "kind": "documentation",
                        "mode": "exists",
                        "path": (
                            "docs/adr/0001-governed-opencode-maintenance.md"
                        ),
                    },
                ],
            },
        )
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def update_formatting_contracts() -> None:
    """Include every maintained file in package and repository formatting gates."""

    package_path = ROOT / "packages/maintenance-agent/package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    lint = package["scripts"]["lint"]
    for token in [
        "fixtures/*.json",
        "../../docs/adr/0001-governed-opencode-maintenance.md",
    ]:
        if token not in lint:
            lint += f" {token}"
    package["scripts"]["lint"] = lint
    package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

    root_path = ROOT / "package.json"
    root = json.loads(root_path.read_text(encoding="utf-8"))
    formatter = root["scripts"]["format:check"]
    maintained_paths = [
        ".github/workflows/opencode-nim-maintenance.yml",
        ".opencode/agents/maintenance-planner.md",
        "product/review-agent-integrity.json",
        "packages/maintenance-agent/package.json",
        "packages/maintenance-agent/src/*.mjs",
        "packages/maintenance-agent/fixtures/*.json",
        "docs/adr/0001-governed-opencode-maintenance.md",
        "docs/operations/opencode-nim-maintenance.md",
        "docs/research/2026-08-07-opencode-nim-maintenance-standards.md",
        (
            "docs/superpowers/specs/"
            "2026-08-07-opencode-nim-maintenance-loop-design.md"
        ),
        (
            "docs/superpowers/plans/"
            "2026-08-07-opencode-nim-maintenance-loop.md"
        ),
        "AGENTS.md",
        "CLAUDE.md",
        "ARCHITECTURE.md",
        "CHANGELOG.md",
    ]
    for maintained_path in maintained_paths:
        token = f" {maintained_path}"
        if token not in formatter:
            formatter += token
    root["scripts"]["format:check"] = formatter
    root_path.write_text(json.dumps(root, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    """Apply every permanent product-boundary update in deterministic order."""

    harden_model_boundary()
    update_workflow_contract_test()
    update_review_agent_digest()
    register_capability()
    update_formatting_contracts()


if __name__ == "__main__":
    main()
