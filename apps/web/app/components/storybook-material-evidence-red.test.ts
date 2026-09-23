import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const repositoryRoot = new URL('../../../../', import.meta.url);

function readRepositoryFile(path: string): string {
  return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

function assertRepositoryFile(path: string): string {
  try {
    return readRepositoryFile(path);
  } catch {
    assert.fail(`Required Storybook evidence file is missing: ${path}`);
  }
}

test('Web exposes an executable, configured accessibility-capable Storybook boundary', () => {
  const packageJson = JSON.parse(
    readRepositoryFile('apps/web/package.json'),
  ) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert.match(
    packageJson.scripts?.storybook ?? '',
    /storybook/,
    'apps/web must expose a Storybook script',
  );
  assert.ok(
    packageJson.devDependencies?.storybook,
    'Storybook must be a lockfile-owned Web development dependency',
  );
  assert.ok(
    packageJson.devDependencies?.['@storybook/addon-a11y'],
    'material stories must have a lockfile-owned accessibility addon',
  );

  const config = assertRepositoryFile('apps/web/.storybook/main.ts');
  assert.match(config, /stories/, 'Storybook config must declare story discovery');
  assert.match(
    config,
    /@storybook\/addon-a11y/,
    'the accessibility addon must be enabled by Storybook, not merely installed',
  );
});

test('QuickCapture story renders production code and names the material state matrix', () => {
  const story = assertRepositoryFile(
    'apps/web/app/components/quick-capture.stories.tsx',
  );

  assert.match(
    story,
    /from ['"]\.\/quick-capture['"]/,
    'the story must import production QuickCapture rather than a source copy',
  );
  assert.match(
    story,
    /component\s*:\s*QuickCapture\b/,
    'Storybook metadata must bind the story to the production QuickCapture component',
  );

  for (const state of [
    'Idle',
    'Loading',
    'ReadyEmpty',
    'ReadyResults',
    'MinimumQuery',
    'SignInRequired',
    'Unavailable',
  ]) {
    assert.match(
      story,
      new RegExp(`export\\s+(?:const|function)\\s+${state}\\b`),
      `QuickCapture story must expose the ${state} buyer state`,
    );
  }
});

test('QuickCapture story carries non-placeholder exact Figma authority traceability', () => {
  const story = assertRepositoryFile(
    'apps/web/app/components/quick-capture.stories.tsx',
  );

  assert.match(
    story,
    /7NUoFkOgZEjOOOCcCqjU1D/,
    'material story must identify the canonical LifeOS Figma file',
  );
  assert.match(
    story,
    /(?:node-id=\d+(?:[-:]\d+)+|node(?:Id|_id)\s*[:=]\s*['"]\d+(?:[-:]\d+)+['"])/i,
    'material story must record a concrete numeric Figma node identity, not a TODO or label-only placeholder',
  );
});

test('QuickCapture story exposes interaction, status, and responsive evidence hooks', () => {
  const story = assertRepositoryFile(
    'apps/web/app/components/quick-capture.stories.tsx',
  );

  assert.match(
    story,
    /\bplay\s*:/,
    'material Storybook evidence must include an executable interaction play function',
  );
  assert.match(
    story,
    /(?:userEvent|within|getByRole|findByRole)/,
    'the play function must use interaction or accessibility queries rather than a visual-only story',
  );
  assert.match(
    story,
    /(?:getByRole|findByRole)\s*\(\s*['"]status['"]/,
    'material evidence must exercise the QuickCapture status announcement contract',
  );
  assert.match(
    story,
    /viewport/i,
    'material evidence must declare responsive viewport coverage',
  );
  for (const viewport of ['mobile', 'intermediate', 'desktop']) {
    assert.match(
      story,
      new RegExp(viewport, 'i'),
      `material evidence must identify a ${viewport} viewport`,
    );
  }
});
