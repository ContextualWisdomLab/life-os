const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const REPOSITORY_WORKFLOW_PATH_PATTERN =
  /^\.github\/workflows\/[^/%\\\u0000-\u001f\u007f]+\.ya?ml$/u;
const WORKFLOW_TREE_CANDIDATE_PATH_PATTERN = /^\.github\/workflows\/[\s\S]*\.ya?ml$/u;
const CONTROL_OR_ESCAPE_PATTERN = /[\\%\u0000-\u001f\u007f]/u;
const WORKFLOW_STATES = new Set([
  'active',
  'deleted',
  'disabled_fork',
  'disabled_inactivity',
  'disabled_manually',
]);
const WORKFLOW_FILE_MODES = new Set(['100644', '100755']);
const PAGE_SIZE = 100;
const MAXIMUM_PAGES = 10;

function invalid(message) {
  throw new Error(message);
}

function requireRepository(value) {
  if (typeof value !== 'string' || !REPOSITORY_PATTERN.test(value)) {
    return invalid('Workflow registry repository is invalid');
  }
  const [owner, repository] = value.split('/');
  if (owner === '.' || owner === '..' || repository === '.' || repository === '..') {
    return invalid('Workflow registry repository is invalid');
  }
  return value;
}

function requireSha(value) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    return invalid('Workflow registry commit SHA is invalid');
  }
  return value.toLowerCase();
}

function requireGeneratedAt(value) {
  if (typeof value !== 'string') {
    return invalid('Workflow registry timestamp is invalid');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    return invalid('Workflow registry timestamp is invalid');
  }
  return value;
}

function requireWorkflowPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    CONTROL_OR_ESCAPE_PATTERN.test(value) ||
    value.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    return invalid('Workflow registry path is invalid');
  }
  if (value.startsWith('.github/') && !REPOSITORY_WORKFLOW_PATH_PATTERN.test(value)) {
    return invalid('Workflow registry path is invalid');
  }
  return value;
}

function requireWorkflowState(value) {
  if (typeof value !== 'string' || !WORKFLOW_STATES.has(value)) {
    return invalid('Workflow registry state is invalid');
  }
  return value;
}

function requireWorkflowRecord(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Number.isSafeInteger(value.id) ||
    value.id <= 0 ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > 512
  ) {
    return invalid('Workflow registry identity is invalid');
  }
  return Object.freeze({
    id: value.id,
    name: value.name,
    path: requireWorkflowPath(value.path),
    state: requireWorkflowState(value.state),
  });
}

function sortById(values) {
  return values.sort((left, right) => left.id - right.id);
}

/**
 * Classifies a complete Actions workflow registry against one exact repository tree.
 *
 * Names are deliberately non-authoritative: only exact case-sensitive repository
 * paths decide whether a repository workflow is still present. Dynamic GitHub-owned
 * workflow identities are retained separately rather than guessed from their names.
 */
export function classifyWorkflowRegistry({ commitSha, treePaths, workflows }) {
  const commit = requireSha(commitSha);
  if (!Array.isArray(treePaths) || !Array.isArray(workflows)) {
    return invalid('Workflow registry evidence is invalid');
  }

  const presentPaths = new Set();
  for (const value of treePaths) {
    if (typeof value !== 'string') return invalid('Workflow registry path is invalid');
    if (!value.startsWith('.github/workflows/')) continue;
    const path = requireWorkflowPath(value);
    if (REPOSITORY_WORKFLOW_PATH_PATTERN.test(path)) presentPaths.add(path);
  }

  const seenIds = new Map();
  const registeredRepositoryPaths = new Map();
  const present = [];
  const activeOrphans = [];
  const disabledOrphans = [];
  const dynamic = [];

  for (const raw of workflows) {
    const record = requireWorkflowRecord(raw);
    const previousPath = seenIds.get(record.id);
    if (previousPath !== undefined) {
      return invalid('Workflow registry identity is ambiguous');
    }
    seenIds.set(record.id, record.path);

    if (!REPOSITORY_WORKFLOW_PATH_PATTERN.test(record.path)) {
      dynamic.push(record);
    } else {
      const previousId = registeredRepositoryPaths.get(record.path);
      if (previousId !== undefined) {
        return invalid('Workflow registry repository path identity is ambiguous');
      }
      registeredRepositoryPaths.set(record.path, record.id);
      if (presentPaths.has(record.path)) {
        if (record.state !== 'active') {
          return invalid('Workflow registry present workflow is disabled');
        }
        present.push(record);
      } else if (record.state === 'active') {
        activeOrphans.push(record);
      } else {
        disabledOrphans.push(record);
      }
    }
  }

  for (const path of presentPaths) {
    if (!registeredRepositoryPaths.has(path)) {
      return invalid('Workflow registry protected-tree workflow is missing from registry');
    }
  }

  return Object.freeze({
    schema: 'life-os.workflow-registry-snapshot.v1',
    commit_sha: commit,
    workflow_count: workflows.length,
    present: Object.freeze(sortById(present)),
    active_orphans: Object.freeze(sortById(activeOrphans)),
    disabled_orphans: Object.freeze(sortById(disabledOrphans)),
    dynamic: Object.freeze(sortById(dynamic)),
  });
}

async function collectWorkflowRegistry(client, repository) {
  const workflows = [];
  let expectedTotal = null;

  for (let page = 1; page <= MAXIMUM_PAGES; page += 1) {
    const payload = await client.requestJson(
      `/repos/${repository}/actions/workflows?per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (
      !payload ||
      !Number.isSafeInteger(payload.total_count) ||
      payload.total_count < 0 ||
      !Array.isArray(payload.workflows) ||
      payload.workflows.length > PAGE_SIZE
    ) {
      return invalid('GitHub workflow registry response is invalid');
    }
    if (expectedTotal === null) expectedTotal = payload.total_count;
    if (payload.total_count !== expectedTotal) {
      return invalid('GitHub workflow registry changed during pagination');
    }

    workflows.push(...payload.workflows);
    if (workflows.length > expectedTotal) {
      return invalid('GitHub workflow registry pagination is inconsistent');
    }
    if (workflows.length === expectedTotal) {
      return Object.freeze({
        workflows: Object.freeze([...workflows]),
        pages: page,
        total_count: expectedTotal,
      });
    }
    if (payload.workflows.length < PAGE_SIZE) {
      return invalid('GitHub workflow registry pagination was truncated');
    }
  }

  return invalid('GitHub workflow registry pagination exceeded the page limit');
}

function workflowRegistriesMatch(left, right) {
  if (
    left.total_count !== right.total_count ||
    left.workflows.length !== right.workflows.length
  ) {
    return false;
  }

  const leftRecords = sortById(left.workflows.map(requireWorkflowRecord));
  const rightRecords = sortById(right.workflows.map(requireWorkflowRecord));
  for (let index = 0; index < leftRecords.length; index += 1) {
    const leftRecord = leftRecords[index];
    const rightRecord = rightRecords[index];
    if (
      leftRecord.id !== rightRecord.id ||
      leftRecord.name !== rightRecord.name ||
      leftRecord.path !== rightRecord.path ||
      leftRecord.state !== rightRecord.state
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Extracts validated repository-owned workflow YAML paths from one complete Git tree.
 *
 * Returns exact case-sensitive `.github/workflows/*.yml|yaml` regular-file paths.
 * Malformed, truncated, symlinked, non-blob, or unsafe workflow-shaped tree evidence
 * fails closed; unrelated tree entries are ignored.
 */
function workflowPathsFromTree(payload) {
  if (!payload || payload.truncated !== false || !Array.isArray(payload.tree)) {
    return invalid('GitHub workflow tree was truncated or invalid');
  }
  const paths = [];
  for (const entry of payload.tree) {
    if (!entry || typeof entry.path !== 'string') continue;
    if (!WORKFLOW_TREE_CANDIDATE_PATH_PATTERN.test(entry.path)) continue;
    requireWorkflowPath(entry.path);
    if (entry.type !== 'blob') {
      return invalid('GitHub workflow tree entry is invalid');
    }
    if (!WORKFLOW_FILE_MODES.has(entry.mode)) {
      return invalid('GitHub workflow tree entry mode is invalid');
    }
    paths.push(entry.path);
  }
  return paths;
}

/**
 * Reads and validates the exact commit SHA currently named by a default branch.
 *
 * Returns a normalized 40-character hexadecimal SHA. Missing or malformed GitHub
 * branch evidence fails closed through the shared SHA validator.
 */
async function readDefaultBranchHead(client, repository, defaultBranch) {
  const payload = await client.requestJson(
    `/repos/${repository}/branches/${encodeURIComponent(defaultBranch)}`,
  );
  return requireSha(payload?.commit?.sha);
}

/**
 * Reads the Git tree SHA bound to an exact commit and verifies commit identity first.
 *
 * Returns a normalized 40-character hexadecimal tree SHA. Malformed responses or a
 * response whose commit SHA differs from the requested immutable commit fail closed.
 */
async function readCommitTreeSha(client, repository, commitSha) {
  const payload = await client.requestJson(
    `/repos/${repository}/git/commits/${commitSha}`,
  );
  if (requireSha(payload?.sha) !== commitSha) {
    return invalid('GitHub workflow commit evidence is inconsistent');
  }
  return requireSha(payload?.tree?.sha);
}

/**
 * Builds read-only, pagination-complete Actions registry evidence for one unchanged
 * protected default-branch head and its exact Git tree. Any branch movement,
 * incomplete tree, or incomplete registry response fails closed so an orphan
 * workflow cannot disappear by omission.
 */
export async function collectWorkflowRegistrySnapshot(
  client,
  repositoryValue,
  expectedCommitSha,
  { generatedAt = new Date().toISOString() } = {},
) {
  if (!client || typeof client.requestJson !== 'function') {
    return invalid('GitHub workflow registry client is invalid');
  }
  const repository = requireRepository(repositoryValue);
  const expected = requireSha(expectedCommitSha);
  const evidenceTimestamp = requireGeneratedAt(generatedAt);
  const metadata = await client.requestJson(`/repos/${repository}`);
  const defaultBranch = metadata?.default_branch;
  if (
    typeof defaultBranch !== 'string' ||
    defaultBranch.length === 0 ||
    defaultBranch.length > 255 ||
    defaultBranch === '.' ||
    defaultBranch === '..' ||
    defaultBranch.includes('/') ||
    CONTROL_OR_ESCAPE_PATTERN.test(defaultBranch)
  ) {
    return invalid('GitHub default branch is invalid');
  }

  const initialHead = await readDefaultBranchHead(client, repository, defaultBranch);
  if (initialHead !== expected) {
    return invalid('Protected default branch moved before workflow inventory');
  }

  const treeSha = await readCommitTreeSha(client, repository, expected);
  const treePayload = await client.requestJson(
    `/repos/${repository}/git/trees/${treeSha}?recursive=1`,
  );
  if (requireSha(treePayload?.sha) !== treeSha) {
    return invalid('GitHub workflow tree evidence is inconsistent');
  }
  const treePaths = workflowPathsFromTree(treePayload);
  const registry = await collectWorkflowRegistry(client, repository);
  const confirmedRegistry = await collectWorkflowRegistry(client, repository);
  if (!workflowRegistriesMatch(registry, confirmedRegistry)) {
    return invalid('GitHub workflow registry changed during inventory');
  }

  const finalHead = await readDefaultBranchHead(client, repository, defaultBranch);
  if (finalHead !== expected) {
    return invalid('Protected default branch moved during workflow inventory');
  }

  const finalMetadata = await client.requestJson(`/repos/${repository}`);
  if (finalMetadata?.default_branch !== defaultBranch) {
    return invalid('GitHub default branch changed during workflow inventory');
  }

  const classified = classifyWorkflowRegistry({
    commitSha: expected,
    treePaths,
    workflows: registry.workflows,
  });
  return Object.freeze({
    ...classified,
    tree_sha: treeSha,
    generated_at: evidenceTimestamp,
    registry_receipt: Object.freeze({
      pages: registry.pages,
      total_count: registry.total_count,
    }),
  });
}
