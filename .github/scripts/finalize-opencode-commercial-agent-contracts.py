"""Apply deterministic corrections for the bounded OpenCode agent contracts."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "packages/commercial-development-agent/src"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    """Replace one exact block or fail without partially guessing intent."""

    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def repair_issue_text_contract() -> None:
    """Permit canonical line feeds in GitHub bodies while rejecting controls."""

    contracts = PACKAGE / "contracts.mjs"
    replace_once(
        contracts,
        "const CONTROL_CHARACTER_PATTERN = /[\\u0000-\\u001f\\u007f]/u;\n",
        "const CONTROL_CHARACTER_PATTERN = /[\\u0000-\\u001f\\u007f]/u;\n"
        "const TEXT_BLOCK_CONTROL_CHARACTER_PATTERN =\n"
        "  /[\\u0000-\\u0009\\u000b-\\u001f\\u007f]/u;\n",
        "contracts text-block pattern",
    )
    require_string = """/** Requires one bounded safe integer. */
function requireInteger(value, minimum, maximum) {
"""
    text_helper = """/** Requires one bounded text block while preserving canonical line feeds. */
function requireTextBlock(value, maximumBytes) {
  if (
    typeof value !== 'string' ||
    byteLength(value) > maximumBytes ||
    TEXT_BLOCK_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalid();
  }
  return value;
}

"""
    replace_once(
        contracts,
        require_string,
        text_helper + require_string,
        "contracts text-block helper",
    )
    replace_once(
        contracts,
        """    body: requireString(input.body, {
      maximumBytes: policy.maximum_issue_body_bytes,
      allowEmpty: true,
      minimumBytes: 0,
    }),
""",
        """    body: requireTextBlock(
      input.body,
      policy.maximum_issue_body_bytes,
    ),
""",
        "issue body contract",
    )

    selector = PACKAGE / "issue-selector.mjs"
    replace_once(
        selector,
        "const CONTROL_CHARACTER_PATTERN = /[\\u0000-\\u001f\\u007f]/u;\n",
        "const CONTROL_CHARACTER_PATTERN = /[\\u0000-\\u001f\\u007f]/u;\n"
        "const TEXT_BLOCK_CONTROL_CHARACTER_PATTERN =\n"
        "  /[\\u0000-\\u0009\\u000b-\\u001f\\u007f]/u;\n",
        "selector text-block pattern",
    )
    replace_once(
        selector,
        """    typeof value.body !== 'string' ||
    value.body.trim() !== value.body ||
    Buffer.byteLength(value.body, 'utf8') > policy.maximum_issue_body_bytes ||
    CONTROL_CHARACTER_PATTERN.test(value.title) ||
    CONTROL_CHARACTER_PATTERN.test(value.body)
""",
        """    typeof value.body !== 'string' ||
    Buffer.byteLength(value.body, 'utf8') > policy.maximum_issue_body_bytes ||
    CONTROL_CHARACTER_PATTERN.test(value.title) ||
    TEXT_BLOCK_CONTROL_CHARACTER_PATTERN.test(value.body)
""",
        "pull-request body contract",
    )


def repair_diff_tests() -> None:
    """Distinguish malformed paths from valid but unauthorized paths."""

    path = PACKAGE / "diff-validator.test.mjs"
    source = path.read_text(encoding="utf-8")
    for entry in [
        "    '../outside.ts',\n",
        "    '/absolute/path.ts',\n",
        "    'apps\\\\windows\\\\path.ts',\n",
    ]:
        if source.count(entry) != 1:
            raise SystemExit(f"malformed path fixture missing: {entry!r}")
        source = source.replace(entry, "", 1)
    marker = """  it.each([
    ['binary', { binary: true }],
"""
    test = """  it.each([
    '../outside.ts',
    '/absolute/path.ts',
    'apps\\\\windows\\\\path.ts',
  ])('fails closed on malformed repository path %s', (path) => {
    expect(() =>
      validateCommercialDevelopmentDiff(
        evidence({ files: [file({ path })] }),
        POLICY,
      ),
    ).toThrow(CommercialDevelopmentDiffError);
  });

"""
    if source.count(marker) != 1:
        raise SystemExit("diff malformed-path insertion marker missing")
    path.write_text(source.replace(marker, test + marker, 1), encoding="utf-8")


def repair_receipt_integration_test() -> None:
    """Pass the production count projection rather than the full decision cell."""

    path = PACKAGE / "dry-run.integration.test.mjs"
    replace_once(
        path,
        """      opencodeVersion: '1.2.3',
      diff,
      branchName: `automation/opencode-commercial-${RUN_ID}`,
""",
        """      opencodeVersion: '1.2.3',
      diff: {
        changed_files: diff.changed_files,
        changed_bytes: diff.changed_bytes,
        additions: diff.additions,
        deletions: diff.deletions,
      },
      branchName: `automation/opencode-commercial-${RUN_ID}`,
""",
        "dry-run receipt projection",
    )


def repair_workflow_contract_tests() -> None:
    """Assert the intended secret and credentialed mutation seams precisely."""

    path = PACKAGE / "workflow-contract.test.mjs"
    replace_once(
        path,
        "    expect(model).not.toContain('secrets.');\n",
        """    expect(model.match(/\\$\\{\\{ secrets\\./gu)).toHaveLength(1);
""",
        "model secret assertion",
    )
    replace_once(
        path,
        "    expect(mutation).toContain('git push origin');\n",
        "    expect(mutation).toContain('push origin \"HEAD:${branch}\"');\n",
        "credentialed push assertion",
    )


def expand_contract_tests() -> None:
    """Cover every branch of the multiline issue-body validator."""

    path = PACKAGE / "contracts.test.mjs"
    replace_once(
        path,
        """    { ...issue(), body: 'x'.repeat(16_385) },
    { ...issue(), body: 'line\\u0000break' },
""",
        """    { ...issue(), body: 42 },
    { ...issue(), body: 'x'.repeat(16_385) },
    { ...issue(), body: 'line\\u0000break' },
""",
        "issue body negative cases",
    )
    replace_once(
        path,
        """  it('validates one bounded open GitHub issue', () => {
    const validated = validateCommercialDevelopmentIssue(issue(), policy());
    expect(validated).toEqual(issue());
    expect(Object.isFrozen(validated)).toBe(true);
  });
""",
        """  it('validates one bounded multiline open GitHub issue', () => {
    const value = {
      ...issue(),
      body: `${issue().body}\\n두 번째 검증 가능한 요구사항입니다.`,
    };
    const validated = validateCommercialDevelopmentIssue(value, policy());
    expect(validated).toEqual(value);
    expect(Object.isFrozen(validated)).toBe(true);
  });
""",
        "multiline issue success case",
    )


def main() -> None:
    """Apply every bounded correction in a deterministic order."""

    repair_issue_text_contract()
    repair_diff_tests()
    repair_receipt_integration_test()
    repair_workflow_contract_tests()
    expand_contract_tests()


if __name__ == "__main__":
    main()
