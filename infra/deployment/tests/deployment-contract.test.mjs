import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  parseProductionImageMap,
  PRODUCTION_SERVICE_NAMES,
  renderProductionKustomization,
  writeProductionOverlay,
} from '../render-production-overlay.mjs';
import {
  splitYamlDocuments,
  validateRenderedProductionManifest,
} from '../validate-rendered-manifest.mjs';
import { createDeploymentProvenance } from '../create-provenance.mjs';

const repositoryRoot = resolve('../..');
const baseDirectory = resolve('../kubernetes/base');
const testImageMapPath = resolve(
  '../kubernetes/overlays/production/image-digests.test.json',
);

async function readBaseManifest() {
  const sourceFiles = [
    'namespace.yaml',
    'runtime-identity.yaml',
    'workloads-public.yaml',
    'workloads-core.yaml',
    'workloads-integrations.yaml',
    'resilience.yaml',
    'network-policies.yaml',
  ];
  const contents = await Promise.all(
    sourceFiles.map((file) => readFile(join(baseDirectory, file), 'utf8')),
  );
  const imageMap = JSON.parse(await readFile(testImageMapPath, 'utf8'));
  let manifest = contents.join('\n---\n');
  for (const serviceName of PRODUCTION_SERVICE_NAMES) {
    manifest = manifest.replaceAll(
      `docker.io/contextualwisdomlab/life-os-${serviceName}:local`,
      imageMap[serviceName],
    );
  }
  return manifest;
}

function replaceRequired(manifest, needle, replacement) {
  assert.ok(manifest.includes(needle), `fixture is missing ${needle}`);
  return manifest.replace(needle, replacement);
}

describe('production image renderer', () => {
  it('accepts the exact immutable service map and renders deterministically', async () => {
    const serialized = await readFile(testImageMapPath, 'utf8');
    const imageMap = parseProductionImageMap(serialized);
    const first = renderProductionKustomization(imageMap);
    const second = renderProductionKustomization(imageMap);

    assert.equal(first, second);
    assert.match(first, /^apiVersion: kustomize\.config\.k8s\.io\/v1beta1/m);
    assert.equal((first.match(/@sha256:/g) ?? []).length, 0);
    assert.equal((first.match(/^\s+digest: sha256:/gm) ?? []).length, 9);
    assert.equal(
      (
        first.match(
          /^\s+- name: docker.io\/contextualwisdomlab\/life-os-/gm,
        ) ?? []
      ).length,
      9,
    );
    assert.equal(
      (
        first.match(
          /^\s+newName: docker.io\/contextualwisdomlab\/life-os-/gm,
        ) ?? []
      ).length,
      9,
    );
  });

  it('writes a private deterministic overlay file', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'life-os-overlay-'),
    );
    try {
      const outputPath = join(temporaryDirectory, 'kustomization.yaml');
      const rendered = await writeProductionOverlay(
        testImageMapPath,
        outputPath,
      );
      assert.equal(await readFile(outputPath, 'utf8'), rendered);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('rejects malformed, oversized, incomplete, extra, mutable, or credential-shaped maps', async () => {
    const valid = JSON.parse(await readFile(testImageMapPath, 'utf8'));
    const invalidMaps = [
      null,
      '',
      '{',
      '[]',
      JSON.stringify({ ...valid, extra: valid.web }),
      JSON.stringify({
        ...Object.fromEntries(
          Object.entries(valid).filter(([key]) => key !== 'web'),
        ),
        website: valid.web,
      }),
      JSON.stringify(
        Object.fromEntries(
          Object.entries(valid).filter(([key]) => key !== 'web'),
        ),
      ),
      JSON.stringify({ ...valid, web: 42 }),
      JSON.stringify({ ...valid, web: '' }),
      JSON.stringify({ ...valid, web: 'ghcr.io/example/web:latest' }),
      JSON.stringify({
        ...valid,
        web: valid.web.replace('sha256:', 'sha256:ABC'),
      }),
      JSON.stringify({
        ...valid,
        web: 'https://ghcr.io/example/web@sha256:' + 'a'.repeat(64),
      }),
      JSON.stringify({
        ...valid,
        web: [
          'ghcr.io/',
          'user',
          ':',
          'pass',
          '@example/web@sha256:',
          'a'.repeat(64),
        ].join(''),
      }),
      JSON.stringify({ ...valid, web: `${valid.web}\n` }),
      JSON.stringify({ ...valid, web: 'x'.repeat(513) }),
      'x'.repeat(32 * 1024 + 1),
    ];
    for (const candidate of invalidMaps) {
      assert.throws(
        () => parseProductionImageMap(candidate),
        new Error('Production image digest map is invalid'),
      );
    }
    assert.throws(
      () => renderProductionKustomization({}),
      new Error('Production image digest map is invalid'),
    );
  });
});

describe('Kubernetes source and rendered manifest contracts', () => {
  it('declares the exact reusable base resources without committed Secrets', async () => {
    const kustomization = await readFile(
      join(baseDirectory, 'kustomization.yaml'),
      'utf8',
    );
    for (const file of [
      'namespace.yaml',
      'runtime-identity.yaml',
      'workloads-public.yaml',
      'workloads-core.yaml',
      'workloads-integrations.yaml',
      'resilience.yaml',
      'network-policies.yaml',
    ]) {
      assert.match(kustomization, new RegExp(`- ${file.replace('.', '\\.')}`));
    }
    const manifest = await readBaseManifest();
    assert.doesNotMatch(manifest, new RegExp(['kind', 'Secret'].join(': ')));
    assert.match(manifest, /pod-security\.kubernetes\.io\/enforce: restricted/);
    assert.equal(
      splitYamlDocuments(manifest).filter((document) =>
        document.includes('kind: Deployment'),
      ).length,
      9,
    );
  });

  it('accepts the complete hardened digest-pinned application bundle', async () => {
    assert.deepEqual(
      validateRenderedProductionManifest(await readBaseManifest()),
      {
        deployments: 9,
        services: 9,
        disruptionBudgets: 9,
        networkPolicies: 6,
      },
    );
  });

  it('rejects empty or oversized YAML streams', () => {
    for (const manifest of ['', 'x'.repeat(4 * 1024 * 1024 + 1)]) {
      assert.throws(
        () => splitYamlDocuments(manifest),
        new Error('Rendered production manifest is invalid'),
      );
    }
  });

  it('rejects every unsafe workload and evidence mutation generically', async () => {
    const valid = await readBaseManifest();
    const mutations = [
      [
        'kind: ServiceAccount',
        `${['kind', 'Secret'].join(': ')}\n${['string', 'Data'].join('')}: {}\n---\nkind: ServiceAccount`,
      ],
      ['@sha256:', '@sha512:'],
      ['image: ghcr.io/', 'image: example.invalid/life-os:latest\n# '],
      ['name: life-os-web', 'name: life-os-web-renamed'],
      ['replicas: 2', 'replicas: 1'],
      ['maxUnavailable: 0', 'maxUnavailable: 1'],
      ['serviceAccountName: life-os-runtime', 'serviceAccountName: default'],
      [
        'automountServiceAccountToken: false',
        ['automountServiceAccountToken', 'true'].join(': '),
      ],
      ['runAsNonRoot: true', 'runAsNonRoot: false'],
      ['type: RuntimeDefault', 'type: Unconfined'],
      [
        'allowPrivilegeEscalation: false',
        ['allowPrivilegeEscalation', 'true'].join(': '),
      ],
      ['readOnlyRootFilesystem: true', 'readOnlyRootFilesystem: false'],
      ['- ALL', '- NET_ADMIN'],
      ['startupProbe:', 'startupCheck:'],
      ['readinessProbe:', 'readinessCheck:'],
      ['livenessProbe:', 'livenessCheck:'],
      ['resources:', 'resourceBudget:'],
      ['topologySpreadConstraints:', 'topologyPolicy:'],
      ['terminationGracePeriodSeconds: 30', 'terminationGracePeriodSeconds: 0'],
      ['configMapRef:', 'configurationRef:'],
      ['type: ClusterIP', 'type: LoadBalancer'],
      ['minAvailable: 1', 'minAvailable: 0'],
      ['name: life-os-default-deny', 'name: removed-default-deny'],
      ['podSelector: {}', 'podSelector:\n    matchLabels:\n      allow: all'],
      ['- Ingress', '- ingress-disabled'],
      ['- Egress', '- egress-disabled'],
    ];
    for (const [needle, replacement] of mutations) {
      assert.throws(
        () =>
          validateRenderedProductionManifest(
            replaceRequired(valid, needle, replacement),
          ),
        new Error('Rendered production manifest is invalid'),
      );
    }
  });

  it('rejects unknown kinds and missing workload, Service, budget, or policy cardinality', async () => {
    const documents = splitYamlDocuments(await readBaseManifest());
    assert.throws(
      () =>
        validateRenderedProductionManifest(
          `${documents.join('\n---\n')}\n---\nmetadata:\n  name: unknown`,
        ),
      new Error('Rendered production manifest is invalid'),
    );
    const removals = [
      'Deployment',
      'Service',
      'PodDisruptionBudget',
      'NetworkPolicy',
    ];
    for (const kind of removals) {
      const index = documents.findIndex((document) =>
        new RegExp(`^kind: ${kind}$`, 'm').test(document),
      );
      assert.notEqual(index, -1);
      const mutated = documents.filter(
        (_, documentIndex) => documentIndex !== index,
      );
      assert.throws(
        () => validateRenderedProductionManifest(mutated.join('\n---\n')),
        new Error('Rendered production manifest is invalid'),
      );
    }
  });
});

describe('deployment provenance', () => {
  it('writes deterministic bounded provenance for the exact manifest bytes', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'life-os-provenance-'),
    );
    try {
      const manifestPath = join(temporaryDirectory, 'life-os-production.yaml');
      const outputPath = join(temporaryDirectory, 'provenance.json');
      await writeFile(manifestPath, 'apiVersion: v1\nkind: List\nitems: []\n');
      const record = await createDeploymentProvenance({
        manifestPath,
        outputPath,
        sourceCommit: 'a'.repeat(40),
        repository: 'ContextualWisdomLab/life-os',
      });
      const persisted = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.deepEqual(persisted, record);
      assert.equal(record.manifest.file_name, 'life-os-production.yaml');
      assert.match(record.manifest.sha256, /^[a-f0-9]{64}$/);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('rejects malformed identity and invalid manifest sizes', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'life-os-provenance-'),
    );
    try {
      const emptyPath = join(temporaryDirectory, 'empty.yaml');
      await writeFile(emptyPath, '');
      for (const input of [
        { sourceCommit: 'short', repository: 'ContextualWisdomLab/life-os' },
        { sourceCommit: 'a'.repeat(40), repository: null },
        { sourceCommit: 'a'.repeat(40), repository: 'invalid' },
      ]) {
        await assert.rejects(
          createDeploymentProvenance({
            manifestPath: emptyPath,
            outputPath: join(temporaryDirectory, 'out.json'),
            ...input,
          }),
          new Error('Deployment provenance input is invalid'),
        );
      }
      await assert.rejects(
        createDeploymentProvenance({
          manifestPath: emptyPath,
          outputPath: join(temporaryDirectory, 'out.json'),
          sourceCommit: 'a'.repeat(40),
          repository: 'ContextualWisdomLab/life-os',
        }),
        new Error('Deployment manifest size is invalid'),
      );
      const oversizedPath = join(temporaryDirectory, 'oversized.yaml');
      await writeFile(oversizedPath, 'x'.repeat(4 * 1024 * 1024 + 1));
      await assert.rejects(
        createDeploymentProvenance({
          manifestPath: oversizedPath,
          outputPath: join(temporaryDirectory, 'out.json'),
          sourceCommit: 'a'.repeat(40),
          repository: 'ContextualWisdomLab/life-os',
        }),
        new Error('Deployment manifest size is invalid'),
      );
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});

describe('workflow and operator contract', () => {
  it('keeps production publication protected, read-only, pinned, and non-deploying', async () => {
    const workflow = await readFile(
      join(repositoryRoot, '.github/workflows/deploy.yml'),
      'utf8',
    );
    assert.match(workflow, /^name: Production Deployment Reference/m);
    assert.match(workflow, /^permissions:\n  contents: read/m);
    assert.match(workflow, /environment:\n\s+name: production/);
    assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
    assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /retention-days: 7/);
    assert.match(workflow, /cancel-in-progress: true/);
    assert.doesNotMatch(workflow, /kubectl\s+(apply|delete|replace|patch)/);
    assert.doesNotMatch(workflow, /permissions:[\s\S]*contents: write/);

    const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map(
      (match) => match[1],
    );
    assert.ok(actionReferences.length >= 3);
    for (const reference of actionReferences) {
      assert.match(reference, /^[^@\s]+@[a-f0-9]{40}$/);
    }
  });

  it('documents required configuration, migration, rollout, rollback, and recovery', async () => {
    const runbook = await readFile(
      join(repositoryRoot, 'docs/operations/production-deployment.md'),
      'utf8',
    );
    for (const heading of [
      '## Required runtime objects',
      '## Image promotion',
      '## Migration order',
      '## Preflight',
      '## Rollout',
      '## Rollback and failed rollout',
      '## Observability and recovery',
      '## Modular deployment',
    ]) {
      assert.ok(runbook.includes(heading));
    }
    assert.match(runbook, /never belong in Git/i);
    assert.match(runbook, /previous verified manifest/i);
  });
});
