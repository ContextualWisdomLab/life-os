#!/usr/bin/env node

import { runCommercialDevelopmentCli } from './cli-core.mjs';

try {
  await runCommercialDevelopmentCli(process.argv.slice(2));
} catch {
  process.stderr.write('Commercial development command failed.\n');
  process.exitCode = 1;
}
