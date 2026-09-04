import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), 'src', path), 'utf8');
}

describe('Identity naming boundary', () => {
  it('keeps the stable application vocabulary while translating to semantic PostgreSQL names in the adapter', async () => {
    const [domainSource, repositorySource] = await Promise.all([
      source('identity-domain.ts'),
      source('postgres-identity-repository.ts'),
    ]);

    expect(domainSource).toContain('export interface User {');
    expect(domainSource).toContain('export interface Workspace {');
    expect(domainSource).toContain('provider: IdentityProvider;');
    expect(domainSource).toContain('user: User;');
    expect(domainSource).toContain('workspace: Workspace;');
    expect(domainSource).not.toContain('userAccountId: string;');
    expect(domainSource).not.toContain('identityWorkspaceId: string;');
    expect(domainSource).not.toContain('identityProvider: IdentityProvider;');

    expect(repositorySource).toContain('identity.user_accounts');
    expect(repositorySource).toContain('user_account_id');
    expect(repositorySource).toContain('external_identity_id');
    expect(repositorySource).toContain('identity_provider');
    expect(repositorySource).toContain('identity.identity_workspaces');
    expect(repositorySource).toContain('identity_workspace_id');
    expect(repositorySource).toContain('owner_user_account_id');
  });
});
