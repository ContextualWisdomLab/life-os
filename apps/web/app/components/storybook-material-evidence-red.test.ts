import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const repositoryRoot = new URL('../../../../../', import.meta.url);

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

test('Web exposes an executable, accessibility-capable Storybook boundary', () => {
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
    'material stories must have an accessibility-capable Storybook test path',
  );

  const config = assertRepositoryFile('apps/web/.storybook/main.ts');
  assert.match(config, /stories/, 'Storybook config must declare story discovery');
});

test('QuickCapture story imports production code and names the material state matrix', () => {
  const story = assertRepositoryFile(
    'apps/web/app/components/quick-capture.stories.tsx',
  );

  assert.match(
    story,
    /from ['"]\.\/quick-capture['"]/,
    'the story must render production QuickCapture rather than a source copy',
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

test('QuickCapture story carries exact Figma authority traceability', () => {
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
    /figma[^\n]*(?:node-id|nodeId|node_id)/i,
    'material story must record an exact Figma node identity, not only a file link',
  );
});
