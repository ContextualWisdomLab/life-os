#!/usr/bin/env node
/** Stage the production transport regression for contextual-orchestrator auto. */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testPath = resolve(
  root,
  'apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts',
);
let source = readFileSync(testPath, 'utf8');
const assertion = "    expect(body.orchestration_mode).toBe('auto');\n";
if (!source.includes(assertion)) {
  const anchor = "    expect(body.model).toBe('contextual-orchestrator');\n";
  const matches = source.split(anchor).length - 1;
  if (matches !== 1) {
    throw new Error(`expected one request-model assertion anchor, found ${matches}`);
  }
  source = source.replace(anchor, `${anchor}${assertion}`);
  writeFileSync(testPath, source, 'utf8');
}
