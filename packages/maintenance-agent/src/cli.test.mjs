import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  main,
  MaintenanceCliError,
  normalizeMaintenanceEvidence,
  publishText,
  readBoundedJson,
  runMaintenanceCli,
} from './cli.mjs';
import { compileMaintenanceContract } from './contract.mjs';

const COMMIT_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const GENERATED_AT = '2026-08-07T06:00:00.000Z';

function snapshot(overrides = {}) {
  return {
    schema: 'life-os.github-snapshot.v1',
    repository: 'ContextualWisdomLab/life-os',
    commit_sha: COMMIT_SHA,
    generated_at: GENERATED_AT,
    truncated: false,
    pull_requests: [
      {
        number: 117,
        head_sha: HEAD_SHA,
        draft: false,
        unresolved_threads: 1,
        blockers: ['workflow-not-successful:CI'],
        workflows: [
          { name: 'CI', status: 'completed', conclusion: 'failure' },
          { name: 'Security Scan', status: 'completed', conclusion: 'success' },
        ],
        statuses: [
          { context: 'CodeRabbit', state: 'pending' },
          { context: 'AppGuardrail', state: 'success' },
        ],
      },
    ],
    issues: [],
    ...overrides,
  };
}

function audit(overrides = {}) {
  return {
    schema: 'life-os.commercial-readiness-report.v1',
    generated_at: GENERATED_AT,
    commit_sha: COMMIT_SHA,
    summary: {
      total_capabilities: 1,
      at_target: 0,
      unresolved_gaps: 1,
      weighted_maturity_percent: 0,
    },
    capabilities: [
      {
        id: 'automation.commercial-readiness-loop',
        customer_impact: 5,
        risk: 4,
        acquisition_impact: 5,
        effort: 3,
        evidence: [
          { path: '.github/workflows/opencode-nim-maintenance.yml' },
        ],
      },
    ],
    gaps: [
      {
        capability_id: 'automation.commercial-readiness-loop',
        missing_evidence: ['packages/maintenance-agent/'],
      },
    ],
    ...overrides,
  };
}

function fingerprint() {
  return {
    workflowPaths: ['.github/workflows/appguardrail.yml'],
    secretNames: ['NVIDIA_NIM_API_KEY'],
    digest: 'c'.repeat(64),
  };
}

function validPlan(contract) {
  return {
    schema: 'life-os.maintenance-plan.v1',
    contractDigest: contract.contractDigest,
    sourceCommitSha: contract.sourceCommitSha,
    action: contract.action,
    computeProfile: contract.computeProfile,
    diagnosisClasses: ['failed_check'],
    steps: [
      {
        sequence: 1,
        title: 'Inspect the bounded failing check evidence.',
        kind: 'inspect',
        pathPrefixes: [],
        expectedEvidence: ['The failing check is reproduced or classified.'],
      },
    ],
    expectedChecks: ['CI'],
    decisionRequired: false,
    reasonCode: 'no_decision_required',
    acknowledgedProhibitions: [...contract.prohibitedOperations],
  };
}

function memoryFileSystem(initial = {}) {
  const files = new Map(Object.entries(initial));
  const calls = [];
  return {
    files,
    calls,
    seam: {
      mkdir: async (path, options) => {
        calls.push(['mkdir', path, options]);
      },
      readFile: async (path) => {
        calls.push(['readFile', path]);
        if (!files.has(path)) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }
        return files.get(path);
      },
      writeFile: async (path, data, options) => {
        calls.push(['writeFile', path, options]);
        if (files.has(path) && options.flag === 'wx') {
          throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        }
        files.set(path, data);
      },
      rename: async (from, to) => {
        calls.push(['rename', from, to]);
        files.set(to, files.get(from));
        files.delete(from);
      },
      unlink: async (path) => {
        calls.push(['unlink', path]);
        if (!files.delete(path)) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }
      },
    },
  };
}

describe('maintenance evidence normalization', () => {
  it('normalizes failed workflow, status, blocker, and review evidence', () => {
    const normalized = normalizeMaintenanceEvidence(
      snapshot(),
      audit(),
      fingerprint(),
    );
    assert.deepEqual(normalized.pullRequests[0].failedChecks, [
      'CI',
      'CodeRabbit',
      'Unresolved Review Threads',
    ]);
    assert.deepEqual(normalized.buyerGaps[0], {
      capabilityId: 'automation.commercial-readiness-loop',
      customerImpact: 5,
      risk: 4,
      acquisitionImpact: 5,
      effort: 3,
      allowedPathPrefixes: ['packages/maintenance-agent/'],
    });
  });

  it('falls back to capability evidence paths when missing evidence is empty', () => {
    const normalized = normalizeMaintenanceEvidence(
      snapshot({ pull_requests: [] }),
      audit({
        gaps: [
          {
            capability_id: 'automation.commercial-readiness-loop',
            missing_evidence: [],
          },
        ],
      }),
      fingerprint(),
    );
    assert.deepEqual(normalized.buyerGaps[0].allowedPathPrefixes, [
      '.github/workflows/opencode-nim-maintenance.yml',
    ]);
  });

  it('rejects mismatched, truncated, or malformed repository evidence', () => {
    const candidates = [
      [snapshot({ schema: 'wrong' }), audit(), fingerprint()],
      [snapshot(), audit({ schema: 'wrong' }), fingerprint()],
      [snapshot({ commit_sha: 'd'.repeat(40) }), audit(), fingerprint()],
      [snapshot({ generated_at: '2026-08-07T07:00:00.000Z' }), audit(), fingerprint()],
      [snapshot({ truncated: true }), audit(), fingerprint()],
      [snapshot({ pull_requests: null }), audit(), fingerprint()],
      [snapshot(), audit({ capabilities: null }), fingerprint()],
      [snapshot(), audit({ gaps: null }), fingerprint()],
      [
        snapshot(),
        audit({ gaps: [{ capability_id: 'unknown', missing_evidence: [] }] }),
        fingerprint(),
      ],
    ];
    for (const args of candidates) {
      assert.throws(
        () => normalizeMaintenanceEvidence(...args),
        MaintenanceCliError,
      );
    }
  });
});

describe('bounded maintenance file operations', () => {
  it('reads one bounded JSON file', async () => {
    const fs = memoryFileSystem({ '/tmp/input.json': '{"safe":true}' });
    assert.deepEqual(
      await readBoundedJson('/tmp/input.json', fs.seam),
      { safe: true },
    );
  });

  it('rejects invalid paths, missing files, malformed JSON, and oversized input', async () => {
    const fs = memoryFileSystem({
      '/tmp/empty.json': '',
      '/tmp/bad.json': '{',
      '/tmp/large.json': `"${'x'.repeat(1024 * 1024)}"`,
    });
    for (const path of [
      'relative.json',
      '/tmp/missing.json',
      '/tmp/empty.json',
      '/tmp/bad.json',
      '/tmp/large.json',
    ]) {
      await assert.rejects(
        readBoundedJson(path, fs.seam),
        MaintenanceCliError,
      );
    }
  });

  it('writes, reads back, and atomically renames restrictive output', async () => {
    const fs = memoryFileSystem();
    await publishText('/tmp/output.json', '{"safe":true}\n', fs.seam, () => 'uuid');
    assert.equal(fs.files.get('/tmp/output.json'), '{"safe":true}\n');
    assert.ok(
      fs.calls.some(
        (call) =>
          call[0] === 'writeFile' &&
          call[2].mode === 0o600 &&
          call[2].flag === 'wx',
      ),
    );
  });

  it('rejects invalid output and cleans failed temporary evidence', async () => {
    await assert.rejects(
      publishText('relative', 'safe'),
      MaintenanceCliError,
    );
    await assert.rejects(
      publishText('/tmp/output', ''),
      MaintenanceCliError,
    );

    const mismatch = memoryFileSystem();
    mismatch.seam.readFile = async () => 'different';
    await assert.rejects(
      publishText('/tmp/output', 'expected', mismatch.seam, () => 'mismatch'),
      MaintenanceCliError,
    );

    const writeFailure = memoryFileSystem();
    writeFailure.seam.writeFile = async () => {
      throw new Error('private disk failure');
    };
    await assert.rejects(
      publishText('/tmp/output', 'expected', writeFailure.seam, () => 'failure'),
      MaintenanceCliError,
    );
  });
});

describe('maintenance CLI commands', () => {
  it('compiles one contract from bounded evidence files', async () => {
    const fs = memoryFileSystem({
      '/tmp/snapshot.json': JSON.stringify(snapshot()),
      '/tmp/audit.json': JSON.stringify(audit()),
      '/tmp/fingerprint.json': JSON.stringify(fingerprint()),
    });
    const contract = await runMaintenanceCli(
      [
        'compile',
        '--snapshot',
        '/tmp/snapshot.json',
        '--audit',
        '/tmp/audit.json',
        '--fingerprint',
        '/tmp/fingerprint.json',
        '--output',
        '/tmp/contract.json',
      ],
      { fileSystem: fs.seam, uuidFactory: () => 'contract' },
    );
    assert.equal(contract.action, 'inspect_pr');
    assert.equal(
      JSON.parse(fs.files.get('/tmp/contract.json')).contractDigest,
      contract.contractDigest,
    );
  });

  it('validates and publishes JSON and Markdown plan evidence', async () => {
    const contract = compileMaintenanceContract(
      normalizeMaintenanceEvidence(snapshot(), audit(), fingerprint()),
    );
    const fs = memoryFileSystem({
      '/tmp/contract.json': JSON.stringify(contract),
      '/tmp/plan.json': JSON.stringify(validPlan(contract)),
    });
    const validated = await runMaintenanceCli(
      [
        'validate-plan',
        '--contract',
        '/tmp/contract.json',
        '--plan',
        '/tmp/plan.json',
        '--validated',
        '/tmp/validated.json',
        '--markdown',
        '/tmp/plan.md',
      ],
      { fileSystem: fs.seam, uuidFactory: () => 'plan' },
    );
    assert.equal(validated.schema, 'life-os.maintenance-plan.v1');
    assert.match(fs.files.get('/tmp/plan.md'), /^# LifeOS maintenance plan/u);
  });

  it('rejects malformed command shapes and unknown commands', async () => {
    for (const argv of [
      [],
      ['compile', '--snapshot'],
      ['compile', 'snapshot', '/tmp/file'],
      ['compile', '--snapshot', '/tmp/a', '--snapshot', '/tmp/b'],
      ['compile', '--snapshot', '/tmp/a'],
      ['unknown'],
      Array.from({ length: 21 }, () => 'x'),
    ]) {
      await assert.rejects(runMaintenanceCli(argv), MaintenanceCliError);
    }
  });

  it('emits only a stable code from the process entry point', async () => {
    const originalWrite = process.stderr.write;
    const originalExitCode = process.exitCode;
    let output = '';
    process.stderr.write = (value) => {
      output += String(value);
      return true;
    };
    try {
      process.exitCode = undefined;
      await main(['unknown']);
      assert.equal(output, 'command_invalid\n');
      assert.equal(process.exitCode, 1);
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = originalExitCode;
    }
  });
});
