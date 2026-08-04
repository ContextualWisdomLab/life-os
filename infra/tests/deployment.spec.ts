import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');
const kubernetesRoot = 'infra/kubernetes';
const baseRoot = `${kubernetesRoot}/base`;

function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function count(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

describe('production Kubernetes reference contract', () => {
  const namespace = read(`${baseRoot}/namespace.yaml`);
  const workloads = read(`${baseRoot}/edge-workloads.yaml`);
  const networkPolicies = read(`${baseRoot}/network-policies.yaml`);
  const base = read(`${baseRoot}/kustomization.yaml`);
  const production = read(
    `${kubernetesRoot}/overlays/production/kustomization.yaml`,
  );
  const workflow = read('.github/workflows/deploy.yml');
  const renderer = read(`${kubernetesRoot}/render-production-manifest.py`);
  const serviceWriter = read(`${kubernetesRoot}/write-pg-service.py`);
  const migrationRunner = read(`${kubernetesRoot}/run-migrations.sh`);
  const trivyConfig = read('trivy.yaml');
  const trustedRegistryData = read('infra/trivy-data/trusted-registries.yaml');

  it('composes one production overlay from the reviewed base', () => {
    expect(base).toContain('kind: Kustomization');
    expect(base).toContain('- namespace.yaml');
    expect(base).toContain('- edge-workloads.yaml');
    expect(base).toContain('- network-policies.yaml');
    expect(production).toContain('- ../../base');
    expect(production).toContain(
      'life-os.io/deployment-contract: production-reference-v1',
    );
  });

  it('enforces Restricted Pod Security at the namespace boundary', () => {
    expect(namespace).toContain('name: life-os');
    expect(namespace).toContain(
      'pod-security.kubernetes.io/enforce: restricted',
    );
    expect(namespace).toContain('pod-security.kubernetes.io/audit: restricted');
    expect(namespace).toContain('pod-security.kubernetes.io/warn: restricted');
    expect(namespace).toMatch(
      /pod-security\.kubernetes\.io\/enforce-version: v1\.\d+/,
    );
  });

  it('hardens and observes both edge workloads', () => {
    expect(count(workloads, /kind: Deployment/g)).toBe(2);
    expect(count(workloads, /replicas: 2/g)).toBe(2);
    expect(count(workloads, /maxUnavailable: 0/g)).toBe(2);
    expect(count(workloads, /maxSurge: 1/g)).toBe(2);
    expect(count(workloads, /automountServiceAccountToken: false/g)).toBe(4);
    expect(count(workloads, /runAsNonRoot: true/g)).toBe(2);
    expect(count(workloads, /readOnlyRootFilesystem: true/g)).toBe(2);
    expect(count(workloads, /allowPrivilegeEscalation: false/g)).toBe(2);
    expect(count(workloads, /type: RuntimeDefault/g)).toBe(2);
    expect(count(workloads, /- ALL/g)).toBe(2);
    expect(count(workloads, /startupProbe:/g)).toBe(2);
    expect(count(workloads, /readinessProbe:/g)).toBe(2);
    expect(count(workloads, /livenessProbe:/g)).toBe(2);
    expect(count(workloads, /requests:/g)).toBe(2);
    expect(count(workloads, /limits:/g)).toBe(2);
    expect(count(workloads, /kind: PodDisruptionBudget/g)).toBe(2);
    expect(count(workloads, /topologySpreadConstraints:/g)).toBe(2);
  });

  it('rejects unapproved or mutable deployment images through one renderer', () => {
    const zeroDigest = '0'.repeat(64);
    const webSentinel = `ghcr.io/contextualwisdomlab/life-os-web@sha256:${zeroDigest}`;
    const gatewaySentinel = `ghcr.io/contextualwisdomlab/life-os-gateway@sha256:${zeroDigest}`;

    expect(workloads).toContain(webSentinel);
    expect(workloads).toContain(gatewaySentinel);
    expect(renderer).toContain(
      'image reference must use the approved LifeOS GHCR path and sha256 digest',
    );
    expect(renderer).toContain(
      'ghcr\\.io/contextualwisdomlab/life-os-web@sha256:[0-9a-f]{64}',
    );
    expect(renderer).toContain(
      'ghcr\\.io/contextualwisdomlab/life-os-gateway@sha256:[0-9a-f]{64}',
    );
    expect(renderer).toContain('zero image digest is not deployable');
    expect(renderer).toContain('timeout=KUSTOMIZE_TIMEOUT_SECONDS');
    expect(count(workflow, /render-production-manifest\.py/g)).toBe(2);
    expect(workflow).not.toContain("python - <<'PY'");
  });

  it('trusts GHCR through policy data while constraining every Kubernetes image', () => {
    const imageLines = workloads
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('image: '));
    const approvedImage =
      /^image: ghcr\.io\/contextualwisdomlab\/life-os-(web|gateway)@sha256:[0-9a-f]{64}$/;

    expect(trivyConfig).toContain('data:\n    - infra/trivy-data');
    expect(trustedRegistryData).toContain('ksv0125:');
    expect(trustedRegistryData).toContain('trusted_registries:\n    - ghcr.io');
    expect(imageLines).toHaveLength(2);
    expect(imageLines.every((line) => approvedImage.test(line))).toBe(true);
    expect(workloads).not.toContain('trivy:ignore:KSV-0125');
    expect(existsSync(resolve(repositoryRoot, '.trivyignore'))).toBe(false);
    expect(existsSync(resolve(repositoryRoot, '.trivyignore.yaml'))).toBe(
      false,
    );
  });

  it('denies ambient access while permitting bounded internal data paths', () => {
    expect(count(workloads, /type: ClusterIP/g)).toBe(2);
    expect(workloads).not.toContain('type: LoadBalancer');
    expect(workloads).not.toContain('kind: Ingress');
    expect(workloads).not.toContain('kind: Secret');
    expect(networkPolicies).toContain('name: default-deny');
    expect(networkPolicies).toContain('name: allow-web-gateway-egress');
    expect(networkPolicies).toContain('name: allow-web-gateway-ingress');
    expect(networkPolicies).toContain('name: allow-gateway-internal-egress');
    expect(networkPolicies).toContain('life-os-postgres');
    expect(networkPolicies).toContain('life-os-nats');
    expect(networkPolicies).toContain('port: 4000');
    expect(networkPolicies).toContain('port: 4222');
    expect(networkPolicies).toContain('port: 5432');
    expect(networkPolicies).toContain("life-os.io/edge-access: 'true'");
    expect(networkPolicies).toContain(
      'kubernetes.io/metadata.name: kube-system',
    );
  });

  it('uses a serialized and protected manual deployment workflow', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).not.toMatch(/^\s+pull_request:/m);
    expect(workflow).toContain('group: life-os-production-deployment');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(count(workflow, /persist-credentials: false/g)).toBe(2);
    expect(workflow).toContain('LIFE_OS_KUBE_CONFIG_B64');
    expect(workflow).toContain('--dry-run=server');
    expect(workflow).toContain('kubectl diff --server-side');
  });

  it('captures and verifies rollback state including an initial deployment', () => {
    expect(workflow).toContain('WEB_PRIOR_REVISION');
    expect(workflow).toContain('GATEWAY_PRIOR_REVISION');
    expect(workflow).toContain('--to-revision="${prior_revision}"');
    expect(workflow).toContain(
      'kubectl delete "deployment/${deployment_name}"',
    );
    expect(workflow).toContain('recovery_failed=0');
    expect(workflow).toContain(
      'Rollout and automatic workload-state recovery both failed.',
    );
  });

  it('uses a private service file instead of a database URI argument', () => {
    expect(serviceWriter).toContain('PGSERVICE');
    expect(serviceWriter).toContain('destination.chmod(0o600)');
    expect(serviceWriter).toContain('ALLOWED_QUERY_PARAMETERS');
    expect(migrationRunner).toContain('PGSERVICEFILE="${service_file}"');
    expect(migrationRunner).toContain('PGSERVICE="${service_name}"');
    expect(migrationRunner).not.toContain('PGDATABASE="${database_url}"');
    expect(migrationRunner).not.toContain('--dbname "${database_url}"');
  });

  it('blocks duplicate and retrograde migration sequences', () => {
    expect(migrationRunner).toContain('migration_sequence integer NOT NULL');
    expect(migrationRunner).toContain(
      'schema_migrations_service_sequence_unique',
    );
    expect(migrationRunner).toContain('MAX(migration_sequence)');
    expect(migrationRunner).toContain(
      'migration_error=migration_sequence_not_forward',
    );
    expect(migrationRunner).toContain(
      'migration_error=incomplete_migration_requires_reconciliation',
    );
    expect(migrationRunner).toContain(
      'migration_error=migration_digest_changed',
    );
  });

  it('registers every database-backed bounded context', () => {
    const databaseVariables = [
      'IDENTITY_DATABASE_URL',
      'PLANNING_DATABASE_URL',
      'HABIT_DATABASE_URL',
      'AI_DATABASE_URL',
      'REVIEW_DATABASE_URL',
    ];
    for (const variable of databaseVariables) {
      expect(migrationRunner).toContain(variable);
    }
  });
});
