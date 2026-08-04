import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');

function readRepositoryFile(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function occurrenceCount(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

describe('production Kubernetes reference contract', () => {
  const namespace = readRepositoryFile(
    'infra/kubernetes/base/namespace.yaml',
  );
  const workloads = readRepositoryFile(
    'infra/kubernetes/base/edge-workloads.yaml',
  );
  const networkPolicies = readRepositoryFile(
    'infra/kubernetes/base/network-policies.yaml',
  );
  const base = readRepositoryFile(
    'infra/kubernetes/base/kustomization.yaml',
  );
  const production = readRepositoryFile(
    'infra/kubernetes/overlays/production/kustomization.yaml',
  );
  const workflow = readRepositoryFile('.github/workflows/deploy.yml');
  const migrationRunner = readRepositoryFile(
    'infra/kubernetes/run-migrations.sh',
  );

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

  it('enforces the Restricted Pod Security profile at the namespace boundary', () => {
    expect(namespace).toContain('name: life-os');
    expect(namespace).toContain(
      'pod-security.kubernetes.io/enforce: restricted',
    );
    expect(namespace).toContain(
      'pod-security.kubernetes.io/audit: restricted',
    );
    expect(namespace).toContain(
      'pod-security.kubernetes.io/warn: restricted',
    );
    expect(namespace).toMatch(
      /pod-security\.kubernetes\.io\/enforce-version: v1\.\d+/,
    );
  });

  it('keeps both edge workloads non-root, least-privilege, bounded, and observable', () => {
    expect(occurrenceCount(workloads, /kind: Deployment/g)).toBe(2);
    expect(occurrenceCount(workloads, /replicas: 2/g)).toBe(2);
    expect(occurrenceCount(workloads, /maxUnavailable: 0/g)).toBe(2);
    expect(occurrenceCount(workloads, /maxSurge: 1/g)).toBe(2);
    expect(occurrenceCount(workloads, /automountServiceAccountToken: false/g)).toBe(
      4,
    );
    expect(occurrenceCount(workloads, /runAsNonRoot: true/g)).toBe(2);
    expect(occurrenceCount(workloads, /readOnlyRootFilesystem: true/g)).toBe(2);
    expect(occurrenceCount(workloads, /allowPrivilegeEscalation: false/g)).toBe(
      2,
    );
    expect(occurrenceCount(workloads, /type: RuntimeDefault/g)).toBe(2);
    expect(occurrenceCount(workloads, /- ALL/g)).toBe(2);
    expect(occurrenceCount(workloads, /startupProbe:/g)).toBe(2);
    expect(occurrenceCount(workloads, /readinessProbe:/g)).toBe(2);
    expect(occurrenceCount(workloads, /livenessProbe:/g)).toBe(2);
    expect(occurrenceCount(workloads, /requests:/g)).toBe(2);
    expect(occurrenceCount(workloads, /limits:/g)).toBe(2);
    expect(occurrenceCount(workloads, /kind: PodDisruptionBudget/g)).toBe(2);
    expect(occurrenceCount(workloads, /topologySpreadConstraints:/g)).toBe(2);
  });

  it('fails closed until both application images are replaced by immutable digests', () => {
    const zeroDigest = '0'.repeat(64);
    expect(workloads).toContain(
      `ghcr.io/contextualwisdomlab/life-os-web@sha256:${zeroDigest}`,
    );
    expect(workloads).toContain(
      `ghcr.io/contextualwisdomlab/life-os-gateway@sha256:${zeroDigest}`,
    );
    expect(workflow).toContain('image reference must use a registry path and sha256 digest');
    expect(workflow).toContain('zero image digest is not deployable');
    expect(workflow).toContain("! grep --quiet 'sha256:0000000000000000000000000000000000000000000000000000000000000000'");
  });

  it('exposes no public load balancer and denies ambient network access', () => {
    expect(occurrenceCount(workloads, /type: ClusterIP/g)).toBe(2);
    expect(workloads).not.toContain('type: LoadBalancer');
    expect(workloads).not.toContain('kind: Ingress');
    expect(workloads).not.toContain('kind: Secret');
    expect(networkPolicies).toContain('name: default-deny');
    expect(networkPolicies).toContain('- Ingress');
    expect(networkPolicies).toContain('- Egress');
    expect(networkPolicies).toContain("life-os.io/edge-access: 'true'");
    expect(networkPolicies).toContain('kubernetes.io/metadata.name: kube-system');
  });

  it('deploys only through a serialized protected manual workflow', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).not.toMatch(/^\s+pull_request:/m);
    expect(workflow).toContain('group: life-os-production-deployment');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
    expect(workflow).toContain('LIFE_OS_KUBE_CONFIG_B64');
    expect(workflow).toContain('--dry-run=server');
    expect(workflow).toContain('kubectl diff --server-side');
    expect(workflow).toContain('kubectl rollout status deployment/life-os-web');
    expect(workflow).toContain('kubectl rollout undo deployment/life-os-gateway');
  });

  it('tracks forward-only migrations without putting database URLs in psql arguments', () => {
    expect(migrationRunner).toContain("readonly MIGRATION_SCHEMA='life_os_deployment'");
    expect(migrationRunner).toContain("readonly MIGRATION_TABLE='schema_migrations'");
    expect(migrationRunner).toContain('migration_sha256 character(64) NOT NULL');
    expect(migrationRunner).toContain("pg_advisory_xact_lock(hashtextextended('life-os-migration-ledger'");
    expect(migrationRunner).toContain('migration_digest_changed:');
    expect(migrationRunner).toContain('LIFE_OS_MIGRATION_CONFIRMATION');
    expect(migrationRunner).toContain('PGDATABASE="${database_url}" psql');
    expect(migrationRunner).not.toContain('--dbname "${database_url}"');
    for (const variable of [
      'IDENTITY_DATABASE_URL',
      'PLANNING_DATABASE_URL',
      'HABIT_DATABASE_URL',
      'AI_DATABASE_URL',
      'REVIEW_DATABASE_URL',
    ]) {
      expect(migrationRunner).toContain(variable);
    }
  });
});
