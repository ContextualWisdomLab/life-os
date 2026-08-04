import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PRODUCTION_SERVICE_NAMES } from './render-production-overlay.mjs';

const INVALID_MANIFEST = 'Rendered production manifest is invalid';
const IMMUTABLE_IMAGE_LINE = /^\s*image:\s+[^\s@]+@sha256:[a-f0-9]{64}\s*$/m;
const RESOURCE_KIND_LINE = /^kind:\s+([^#\n]+?)\s*$/m;
const METADATA_NAME_LINE = /^ {2}name:\s+([^#\n]+?)\s*$/m;

/** Splits a bounded Kubernetes YAML stream into non-empty documents. */
export function splitYamlDocuments(manifest) {
  if (
    typeof manifest !== 'string' ||
    manifest.length === 0 ||
    Buffer.byteLength(manifest, 'utf8') > 4 * 1024 * 1024
  ) {
    throw new Error(INVALID_MANIFEST);
  }
  return manifest
    .split(/^---\s*$/m)
    .map((document) => document.trim())
    .filter(Boolean);
}

/** Reads one top-level Kubernetes resource kind from a controlled document. */
function readResourceKind(document) {
  return RESOURCE_KIND_LINE.exec(document)?.[1]?.trim();
}

/** Reads the first two-space-indented metadata name from a controlled document. */
function readMetadataName(document) {
  return METADATA_NAME_LINE.exec(document)?.[1]?.trim();
}

/** Requires one security or reliability fragment without echoing manifest data. */
function requireFragment(document, fragment) {
  if (!document.includes(fragment)) {
    throw new Error(INVALID_MANIFEST);
  }
}

/** Validates a Deployment against the production hardening contract. */
function validateDeployment(document) {
  for (const fragment of [
    'replicas: 2',
    'maxUnavailable: 0',
    'maxSurge: 1',
    'serviceAccountName: life-os-runtime',
    'automountServiceAccountToken: false',
    'runAsNonRoot: true',
    'type: RuntimeDefault',
    'allowPrivilegeEscalation: false',
    'readOnlyRootFilesystem: true',
    '- ALL',
    'startupProbe:',
    'readinessProbe:',
    'livenessProbe:',
    'resources:',
    'requests:',
    'limits:',
    'topologySpreadConstraints:',
    'terminationGracePeriodSeconds: 30',
    'configMapRef:',
  ]) {
    requireFragment(document, fragment);
  }
  if (!IMMUTABLE_IMAGE_LINE.test(document)) {
    throw new Error(INVALID_MANIFEST);
  }
}

/** Validates a rendered LifeOS production bundle and returns a stable summary. */
export function validateRenderedProductionManifest(manifest) {
  const documents = splitYamlDocuments(manifest);
  const forbiddenFragments = [
    ['kind', 'Secret'].join(': '),
    'stringData:',
    'hostPath:',
    ['hostNetwork', 'true'].join(': '),
    ['hostPID', 'true'].join(': '),
    ['hostIPC', 'true'].join(': '),
    ['privileged', 'true'].join(': '),
    ['allowPrivilegeEscalation', 'true'].join(': '),
    ['automountServiceAccountToken', 'true'].join(': '),
    ':latest',
    ':replace-me',
  ];
  for (const fragment of forbiddenFragments) {
    if (manifest.includes(fragment)) {
      throw new Error(INVALID_MANIFEST);
    }
  }

  const allowedKinds = new Set([
    'Namespace',
    'ServiceAccount',
    'Deployment',
    'Service',
    'PodDisruptionBudget',
    'NetworkPolicy',
  ]);
  if (
    documents.some(
      (document) => !allowedKinds.has(readResourceKind(document)),
    )
  ) {
    throw new Error(INVALID_MANIFEST);
  }

  const deployments = documents.filter(
    (document) => readResourceKind(document) === 'Deployment',
  );
  const services = documents.filter(
    (document) => readResourceKind(document) === 'Service',
  );
  const budgets = documents.filter(
    (document) => readResourceKind(document) === 'PodDisruptionBudget',
  );
  const policies = documents.filter(
    (document) => readResourceKind(document) === 'NetworkPolicy',
  );

  if (
    deployments.length !== PRODUCTION_SERVICE_NAMES.length ||
    services.length !== PRODUCTION_SERVICE_NAMES.length ||
    budgets.length !== PRODUCTION_SERVICE_NAMES.length ||
    policies.length < 6
  ) {
    throw new Error(INVALID_MANIFEST);
  }

  for (const serviceName of PRODUCTION_SERVICE_NAMES) {
    const deployment = deployments.find(
      (document) => readMetadataName(document) === `life-os-${serviceName}`,
    );
    const service = services.find(
      (document) => readMetadataName(document) === `life-os-${serviceName}`,
    );
    const budget = budgets.find(
      (document) => readMetadataName(document) === `life-os-${serviceName}`,
    );
    if (!deployment || !service || !budget) {
      throw new Error(INVALID_MANIFEST);
    }
    validateDeployment(deployment);
    requireFragment(service, 'type: ClusterIP');
    requireFragment(budget, 'minAvailable: 1');
  }

  const defaultDeny = policies.find(
    (document) => readMetadataName(document) === 'life-os-default-deny',
  );
  if (!defaultDeny) {
    throw new Error(INVALID_MANIFEST);
  }
  requireFragment(defaultDeny, 'podSelector: {}');
  requireFragment(defaultDeny, '- Ingress');
  requireFragment(defaultDeny, '- Egress');

  return Object.freeze({
    deployments: deployments.length,
    services: services.length,
    disruptionBudgets: budgets.length,
    networkPolicies: policies.length,
  });
}

/* node:coverage disable */
/** Runs the bounded manifest validator CLI. */
async function runCli() {
  if (process.argv.length !== 3 || !process.argv[2]) {
    throw new Error('Usage: validate-rendered-manifest.mjs <manifest.yaml>');
  }
  const manifest = await readFile(process.argv[2], 'utf8');
  const summary = validateRenderedProductionManifest(manifest);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : INVALID_MANIFEST;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
/* node:coverage enable */
