import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');

/** Read one repository-relative UTF-8 file for deterministic authority assertions. */
function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('AI database migration authority contract', () => {
  const migrationRunner = read('infra/kubernetes/run-migrations.sh');
  const deploymentWorkflow = read('.github/workflows/deploy.yml');
  const erasureMigration = read(
    'apps/ai-service/migrations/0002_data_rights_erasure.sql',
  );

  it('keeps AI migration ownership distinct from runtime authority', () => {
    expect(migrationRunner).toContain('AI_MIGRATION_DATABASE_URL');
    expect(migrationRunner).toContain('AI_DATABASE_RUNTIME_ROLE');
    expect(migrationRunner).toContain('migration_role_matches_runtime_role');
    expect(migrationRunner).toContain(
      'GRANT USAGE ON SCHEMA ai TO :"service_runtime_role"',
    );
    expect(migrationRunner).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE\n  ai.proposal_audit_records,\n  ai.proposal_decision_events\nFROM :"service_runtime_role";\nGRANT SELECT, INSERT ON TABLE',
    );
    expect(migrationRunner).toContain(
      'GRANT SELECT, INSERT ON TABLE ai.proposal_audit_records, ai.proposal_decision_events',
    );
    expect(migrationRunner).toContain(
      'GRANT EXECUTE ON FUNCTION ai.erase_workspace_data(uuid, uuid, uuid, uuid)',
    );

    const migrationStep =
      deploymentWorkflow.match(
        /- name: Apply forward-only migrations[\s\S]*?\n      - name: /u,
      )?.[0] ?? '';
    expect(migrationStep).toContain(
      'AI_MIGRATION_DATABASE_URL: ${{ secrets.AI_MIGRATION_DATABASE_URL }}',
    );
    expect(migrationStep).toContain(
      'AI_DATABASE_RUNTIME_ROLE: ${{ vars.AI_DATABASE_RUNTIME_ROLE }}',
    );
    expect(migrationStep).not.toContain('AI_DATABASE_URL:');
  });

  it('transfers legacy AI object ownership to the migration authority', () => {
    expect(erasureMigration).toContain('ALTER SCHEMA ai OWNER TO CURRENT_USER');
    expect(erasureMigration).toContain(
      'ALTER TABLE ai.proposal_audit_records OWNER TO CURRENT_USER',
    );
    expect(erasureMigration).toContain(
      'ALTER TABLE ai.proposal_decision_events OWNER TO CURRENT_USER',
    );
    expect(erasureMigration).toContain(
      'ALTER FUNCTION ai.reject_proposal_audit_mutation() OWNER TO CURRENT_USER',
    );
  });
});
