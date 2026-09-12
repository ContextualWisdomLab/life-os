import assert from 'node:assert/strict';
import test from 'node:test';

const PULL_REQUEST_CONDITION = "github.event_name == 'pull_request'";
const SAME_REPOSITORY_CONDITION =
  'github.event.pull_request.head.repo.full_name == github.repository';

/** Legacy text-wide guard check retained only to prove the review finding RED. */
function assertProvenanceGuard(step) {
  assert.ok(
    step.includes(PULL_REQUEST_CONDITION),
    'provenance step must require pull_request events in its direct if guard',
  );
  assert.ok(
    step.includes(SAME_REPOSITORY_CONDITION),
    'provenance step must require same-repository pull requests in its direct if guard',
  );
}

test('provenance condition rejects guard strings that exist only outside the if key', () => {
  const hostileStep = [
    '      - name: Materialize AppGuardrail SARIF PR merge provenance',
    '        if: always()',
    `        # ${PULL_REQUEST_CONDITION}`,
    '        run: |',
    `          echo "${SAME_REPOSITORY_CONDITION}"`,
  ].join('\n');

  assert.throws(
    () => assertProvenanceGuard(hostileStep),
    /direct if guard/u,
    'comments or run-block text must not satisfy the provenance guard contract',
  );
});
