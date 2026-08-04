import { readFileSync } from 'node:fs';
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
  const migrationRunner = read(`${kubernetesRoot}/run-migrations.sh`);

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

  it('rejects unapproved or mutable deployment images', () => {
    const zeroDigest = '0'.repeat(64);
    const webSentinel = `ghcr.io/contextualwisdomlab/life-os-web@sha256:${zeroDigest}`;
    const gatewaySentinel = `ghcr.io/contextualwisdomlab/life-os-gateway@sha256:${zeroDigest}`;
    const approvedImageError =
      'image reference must use the approved LifeOS GHCR path and sha256 digest';
    const unresolvedSentinel =
      "! grep --quiet 'sha256:0000000000000000000000000000000000000000000000000000000000000000'";

    expect(workloads).toContain(webSentinel);
    expect(workloads).toContain(gatewaySentinel);
    expect(workflow).toContain(approvedImageError);
    expect(workflow).toContain(
      'ghcr\\.io/contextualwisdomlab/life-os-web@sha256:[0-9a-f]{64}',
    );
    expect(workflow).toContain(
      'ghcr\\.io/contextualwisdomlab/life-os-gateway@sha256:[0-9a-f]{64}',
    );
    expect(workflow).toContain('zero image digest is not deployable');
    expect(workflow).toContain(unresolvedSentinel);
  });

  it('denies ambient network access and public exposure', () => {
    expect(count(workloads, /type: ClusterIP/g)).toBe(2);
    expect(workloads).not.toContain('type: LoadBalancer');
    expect(workloads).not.toContain('kind: Ingress');
    expect(workloads).not.toContain('kind: Secret');
    expect(networkPolicies).toContain('name: default-deny');
    expect(networkPolicies).toContain('- Ingress');
    expect(networkPolicies).toContain('- Egress');
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
    expect(workflow).toContain(
      'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    );
    expect(workflow).toContain('LIFE_OS_KUBE_CONFIG_B64');
    expect(workflow).toContain('--dry-run=server');
    expect(workflow).toContain('kubectl diff --server-side');
    expect(workflow).toContain('kubectl rollout status deployment/life-os-web');
    expect(workflow).toContain(
      'kubectl rollout undo deployment/life-os-gateway',
    );
  });

  it('tracks forward-only migrations without URL arguments', () => {
    expect(migrationRunner).toContain(
      "readonly MIGRATION_SCHEMA='life_os_deployment'",
    );
    expect(migrationRunner).toContain(
      "readonly MIGRATION_TABLE='schema_migrations'",
    );
    expect(migrationRunner).toContain(
      'migration_sha256 character(64) NOT NULL',
    );
    expect(migrationRunner).toContain("pg_advisory_lock(hashtextextended('");
    expect(migrationRunner).toContain(
      'migration_error=migration_digest_changed',
    );
    expect(migrationRunner).toContain(
      'migration_error=incomplete_migration_requires_reconciliation',
    );
    expect(migrationRunner).toContain(
      "migration_status IN ('applying', 'applied')",
    );
    expect(migrationRunner).toContain('LIFE_OS_MIGRATION_CONFIRMATION');
    expect(migrationRunner).toContain('PGDATABASE="${database_url}" psql');
    expect(migrationRunner).not.toContain('--dbname "${database_url}"');

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
