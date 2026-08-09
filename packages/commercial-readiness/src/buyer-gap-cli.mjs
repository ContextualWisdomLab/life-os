#!/usr/bin/env node
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { evaluateCapabilities } from './audit.mjs';
import {
  collectBuyerGapSnapshot,
  evaluateBuyerGaps,
  validateBuyerGapRegistry,
} from './buyer-gaps.mjs';
import { GitHubApiClient } from './github-client.mjs';
import { renderCommercialReadinessIssue } from './render.mjs';
import {
  validateCapabilityManifest,
  validateCommercialReadinessPolicy,
  validateGitHubSnapshot,
} from './schema.mjs';

const FLAG_TO_KEY = Object.freeze({
  '--repository': 'repository',
  '--manifest': 'manifest',
  '--buyer-gaps': 'buyerGaps',
  '--snapshot': 'snapshot',
  '--policy': 'policy',
  '--root': 'root',
  '--output-json': 'outputJson',
  '--output-markdown': 'outputMarkdown',
});
const REQUIRED_KEYS = Object.freeze(Object.values(FLAG_TO_KEY));

function invalidCommand() {
  throw new Error('Invalid buyer gap audit command');
}

/** Parses the fixed, non-shell commercial buyer-gap audit command surface. */
export function parseBuyerGapArguments(argv) {
  if (!Array.isArray(argv)) invalidCommand();
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = FLAG_TO_KEY[argv[index]];
    if (!key || Object.hasOwn(options, key)) invalidCommand();
    const value = argv[index + 1];
    if (
      typeof value !== 'string' ||
      !value ||
      value.startsWith('--') ||
      value.length > 500 ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      invalidCommand();
    }
    options[key] = value;
    index += 1;
  }
  if (REQUIRED_KEYS.some((key) => !Object.hasOwn(options, key))) invalidCommand();
  return options;
}

async function readJson(path, maxBytes = 1024 * 1024) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Buyer gap audit input must be a regular file');
  }
  if (metadata.size > maxBytes) {
    throw new Error('Buyer gap audit input exceeded the size limit');
  }
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Buyer gap audit JSON was invalid');
    throw error;
  }
}

async function writeAtomic(path, content) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}

/** Runs the capability audit and canonical buyer-gap reconciliation together. */
export async function runBuyerGapAudit(options, environment = process.env) {
  const [manifestValue, registryValue, snapshotValue, policyValue] = await Promise.all([
    readJson(options.manifest),
    readJson(options.buyerGaps),
    readJson(options.snapshot),
    readJson(options.policy),
  ]);
  const manifest = validateCapabilityManifest(manifestValue);
  const registry = validateBuyerGapRegistry(registryValue, manifest);
  const snapshot = validateGitHubSnapshot(snapshotValue);
  const policy = validateCommercialReadinessPolicy(policyValue);
  const token = environment.GITHUB_TOKEN;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('GitHub token is required');
  }
  const client = new GitHubApiClient({ token });
  const gapSnapshot = await collectBuyerGapSnapshot(
    client,
    options.repository,
    registry,
    snapshot.generated_at,
  );
  const buyerGapEvidence = evaluateBuyerGaps(registry, gapSnapshot);
  const report = await evaluateCapabilities(manifest, {
    rootDir: options.root,
    generatedAt: snapshot.generated_at,
    commitSha: snapshot.commit_sha,
    buyerGapEvidence,
  });
  const markdown = renderCommercialReadinessIssue(report, snapshot, {
    marker: policy.readiness_issue_marker,
    maxGaps: 20,
  });
  await Promise.all([
    writeAtomic(options.outputJson, `${JSON.stringify(report, null, 2)}\n`),
    writeAtomic(options.outputMarkdown, markdown),
  ]);
  return report;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseBuyerGapArguments(argv);
  const report = await runBuyerGapAudit(options);
  console.log(
    `audit: ${report.summary.capability_evidence_gaps} capability evidence gap(s), ${report.summary.unresolved_buyer_gaps} canonical buyer gap(s), ${report.summary.unknown_buyer_gap_states} unknown buyer-gap state(s)`,
  );
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Buyer gap audit failed',
    );
    process.exitCode = 1;
  });
}
