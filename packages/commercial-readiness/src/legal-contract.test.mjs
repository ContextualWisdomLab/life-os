import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repositoryRoot = process.env.LIFE_OS_REPOSITORY_ROOT
  ? resolve(process.env.LIFE_OS_REPOSITORY_ROOT)
  : resolve(fileURLToPath(new URL('../../../', import.meta.url)));

/** Reads one UTF-8 repository file from the configured test root. */
async function repositoryFile(path) {
  return await readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('open-source legal readiness contract', () => {
  it('declares Apache-2.0 consistently in package and distribution notices', async () => {
    const packageManifest = JSON.parse(await repositoryFile('package.json'));
    const license = await repositoryFile('LICENSE');
    const notice = await repositoryFile('NOTICE');

    assert.equal(packageManifest.license, 'Apache-2.0');
    assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
    assert.match(license, /Grant of Patent License/);
    assert.match(license, /Redistribution/);
    assert.match(license, /Disclaimer of Warranty/);
    assert.match(notice, /^LifeOS\s*$/m);
    assert.match(notice, /Copyright 2026 ContextualWisdomLab/);
    assert.match(
      notice,
      /This product includes software developed by ContextualWisdomLab\./,
    );
    assert.match(
      notice,
      /Third-party software and assets remain subject to their respective license and attribution terms\./,
    );
    assert.match(notice, /does not grant permission to use/i);
  });

  it('keeps upstream project notices distinct from independent deployments', async () => {
    const privacy = await repositoryFile('docs/legal/privacy.md');
    const terms = await repositoryFile('docs/legal/terms.md');

    for (const document of [privacy, terms]) {
      assert.match(document, /\*\*Version:\*\* 1\.0/);
      assert.match(document, /\*\*Effective date:\*\* 2026-08-04/);
      assert.match(document, /independent LifeOS deployment/i);
      assert.doesNotMatch(document, /TODO|TBD|example@example\.com/i);
    }

    assert.match(privacy, /does not intentionally receive data/i);
    assert.match(privacy, /does not enable upstream product telemetry/i);
    assert.match(terms, /not a turnkey compliance certification/i);
    assert.match(terms, /No hosted-service commitment/i);
  });

  it('defines contribution provenance and private-first security reporting', async () => {
    const contributing = await repositoryFile('CONTRIBUTING.md');
    const security = await repositoryFile('SECURITY.md');

    assert.match(contributing, /inbound-equals-outbound/i);
    assert.match(contributing, /right to submit/i);
    assert.match(contributing, /required GitHub checks pass/i);
    assert.match(security, /Do \*\*not\*\* open a public issue/i);
    assert.match(security, /Report a vulnerability/);
    assert.match(security, /systems, accounts, deployments, and data you own/i);
  });

  it('links every legal and security boundary from the project entry point', async () => {
    const readme = await repositoryFile('README.md');

    for (const path of [
      'LICENSE',
      'NOTICE',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'docs/legal/privacy.md',
      'docs/legal/terms.md',
    ]) {
      const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(readme, new RegExp(`\\[[^\\]\\n]+\\]\\(${escapedPath}\\)`));
    }

    assert.doesNotMatch(readme, /no license grant is implied/i);
    assert.doesNotMatch(readme, /targets `develop`/i);
  });
});
