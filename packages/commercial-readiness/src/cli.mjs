#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateCapabilities } from './audit.mjs';
import {
  collectRepositorySnapshot,
  GitHubApiClient,
  mergeEligiblePullRequests,
  mergePullRequestThroughApi,
  syncReadinessIssue
} from './github-client.mjs';
import { renderCommercialReadinessIssue } from './render.mjs';
import {
  validateCapabilityManifest,
  validateCommercialReadinessPolicy,
  validateGitHubSnapshot
} from './schema.mjs';

const COMMANDS = Object.freeze({
  snapshot: {
    values: new Set(['repository', 'policy', 'output', 'commit', 'generatedAt']),
    booleans: new Set()
  },
  audit: {
    values: new Set([
      'manifest',
      'snapshot',
      'policy',
      'root',
      'outputJson',
      'outputMarkdown'
    ]),
    booleans: new Set()
  },
  publish: {
    values: new Set(['repository', 'policy', 'report']),
    booleans: new Set()
  },
  drain: {
    values: new Set(['repository', 'policy', 'output']),
    booleans: new Set(['dryRun', 'merge'])
  }
});

const FLAG_TO_KEY = Object.freeze({
  '--repository': 'repository',
  '--policy': 'policy',
  '--output': 'output',
  '--commit': 'commit',
  '--generated-at': 'generatedAt',
  '--manifest': 'manifest',
  '--snapshot': 'snapshot',
  '--root': 'root',
  '--output-json': 'outputJson',
  '--output-markdown': 'outputMarkdown',
  '--report': 'report',
  '--dry-run': 'dryRun',
  '--merge': 'merge'
});

function invalidCommand() {
  throw new Error('Invalid commercial readiness command');
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) invalidCommand();
  const command = argv[0];
  const definition = COMMANDS[command];
  if (!definition) invalidCommand();
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = FLAG_TO_KEY[flag];
    if (!key || Object.hasOwn(options, key)) invalidCommand();
    if (definition.booleans.has(key)) {
      options[key] = true;
      continue;
    }
    if (!definition.values.has(key)) invalidCommand();
    const value = argv[index + 1];
    if (
      typeof value !== 'string' ||
      !value ||
      value.startsWith('--') ||
      value.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      invalidCommand();
    }
    options[key] = value;
    index += 1;
  }
  if (options.dryRun && options.merge) invalidCommand();
  return { command, options };
}

function requireOptions(options, names) {
  for (const name of names) {
    if (typeof options[name] !== 'string' || !options[name]) invalidCommand();
  }
}

export async function readJsonFile(path, maxBytes = 1024 * 1024) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('JSON input must be a regular file');
  }
  if (metadata.size > maxBytes) throw new Error('JSON input exceeded the size limit');
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('JSON input was invalid');
    throw error;
  }
}

async function readTextFile(path, maxBytes = 64 * 1024) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Text input must be a regular file');
  }
  if (metadata.size > maxBytes) throw new Error('Text input exceeded the size limit');
  return await readFile(path, 'utf8');
}

async function writeAtomic(path, content) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}

async function writeJson(path, value) {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function githubClientFromEnvironment() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GitHub token is required');
  return new GitHubApiClient({ token });
}

async function loadPolicy(path) {
  return validateCommercialReadinessPolicy(await readJsonFile(path));
}

async function commandSnapshot(options) {
  requireOptions(options, ['repository', 'policy', 'output', 'commit']);
  const policy = await loadPolicy(options.policy);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const snapshot = validateGitHubSnapshot(
    await collectRepositorySnapshot(githubClientFromEnvironment(), options.repository, {
      policy,
      commitSha: options.commit,
      generatedAt
    })
  );
  await writeJson(options.output, snapshot);
  console.log(
    `snapshot: ${snapshot.pull_requests.length} pull request(s), ${snapshot.issues.length} issue(s)`
  );
}

async function commandAudit(options) {
  requireOptions(options, [
    'manifest',
    'snapshot',
    'policy',
    'root',
    'outputJson',
    'outputMarkdown'
  ]);
  const [manifestValue, snapshotValue, policy] = await Promise.all([
    readJsonFile(options.manifest),
    readJsonFile(options.snapshot),
    loadPolicy(options.policy)
  ]);
  const manifest = validateCapabilityManifest(manifestValue);
  const snapshot = validateGitHubSnapshot(snapshotValue);
  const report = await evaluateCapabilities(manifest, {
    rootDir: options.root,
    generatedAt: snapshot.generated_at,
    commitSha: snapshot.commit_sha
  });
  const markdown = renderCommercialReadinessIssue(report, snapshot, {
    marker: policy.readiness_issue_marker,
    maxGaps: 20
  });
  await Promise.all([
    writeJson(options.outputJson, report),
    writeAtomic(options.outputMarkdown, markdown)
  ]);
  console.log(`audit: ${report.summary.unresolved_gaps} unresolved buyer gap(s)`);
}

async function commandPublish(options) {
  requireOptions(options, ['repository', 'policy', 'report']);
  const policy = await loadPolicy(options.policy);
  const body = await readTextFile(options.report);
  const issue = await syncReadinessIssue(githubClientFromEnvironment(), options.repository, {
    marker: policy.readiness_issue_marker,
    title: policy.readiness_issue_title,
    body
  });
  console.log(`readiness issue: #${issue.number}`);
}

function assertMergeExecutionContext(policy) {
  const event = process.env.GITHUB_EVENT_NAME;
  const ref = process.env.GITHUB_REF;
  if (!['schedule', 'workflow_dispatch'].includes(event)) {
    throw new Error('Merge mode is restricted to scheduled or manual default-branch runs');
  }
  if (ref !== `refs/heads/${policy.default_branch}`) {
    throw new Error('Merge mode is restricted to the protected default branch');
  }
}

async function commandDrain(options) {
  requireOptions(options, ['repository', 'policy', 'output']);
  const policy = await loadPolicy(options.policy);
  const execute = options.merge === true;
  if (execute) assertMergeExecutionContext(policy);
  const client = githubClientFromEnvironment();
  const commitSha = process.env.GITHUB_SHA;
  if (typeof commitSha !== 'string') throw new Error('GitHub commit SHA is required');
  const collectPullRequests = async () => {
    const snapshot = validateGitHubSnapshot(
      await collectRepositorySnapshot(client, options.repository, {
        policy,
        commitSha,
        generatedAt: new Date().toISOString()
      })
    );
    return snapshot.pull_requests;
  };
  const results = await mergeEligiblePullRequests({
    repository: options.repository,
    policy,
    dryRun: !execute,
    collectPullRequests,
    mergePullRequest: async (number, expectedHeadSha, mergeMethod) =>
      await mergePullRequestThroughApi(
        client,
        options.repository,
        number,
        expectedHeadSha,
        mergeMethod
      )
  });
  const payload = {
    schema: 'life-os.pr-drain.v1',
    generated_at: new Date().toISOString(),
    mode: execute ? 'merge' : 'dry-run',
    results
  };
  await writeJson(options.output, payload);
  console.log(
    `drain: ${
      results.filter((item) => item.action === 'merged').length
    } merged, ${results.filter((item) => item.action === 'blocked').length} blocked`
  );
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command === 'snapshot') return await commandSnapshot(options);
  if (command === 'audit') return await commandAudit(options);
  if (command === 'publish') return await commandPublish(options);
  if (command === 'drain') return await commandDrain(options);
  invalidCommand();
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'Commercial readiness loop failed';
    console.error(message);
    process.exitCode = 1;
  });
}
