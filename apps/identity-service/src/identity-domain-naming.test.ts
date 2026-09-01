import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function identityDomainSource(): Promise<string> {
  return readFile(resolve(process.cwd(), 'src', 'identity-domain.ts'), 'utf8');
}

describe('identity domain naming contract', () => {
  it('uses bounded-context names for organization-owned aggregate fields', async () => {
    const domainSource = await identityDomainSource();

    expect(domainSource).toContain('export interface UserAccount {');
    expect(domainSource).toContain('userAccountId: string;');
    expect(domainSource).toContain('externalIdentityId: string;');
    expect(domainSource).toContain('identityProvider: IdentityProvider;');
    expect(domainSource).toContain('export interface IdentityWorkspace {');
    expect(domainSource).toContain('identityWorkspaceId: string;');
    expect(domainSource).toContain('ownerUserAccountId: string;');
    expect(domainSource).toContain('workspaceName: string;');
    expect(domainSource).toContain("workspaceKind: 'personal';");
    expect(domainSource).toContain('userAccount: UserAccount;');
    expect(domainSource).toContain('identityWorkspace: IdentityWorkspace;');

    expect(domainSource).not.toContain('export interface User {');
    expect(domainSource).not.toContain('export interface Workspace {');
  });
});
