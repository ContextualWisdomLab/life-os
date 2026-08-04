import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

/** Returns a lowercase SHA-256 digest for one deployment evidence buffer. */
function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

/** Creates a bounded provenance record for the exact rendered manifest. */
export async function createDeploymentProvenance({
  manifestPath,
  outputPath,
  sourceCommit,
  repository,
}) {
  if (
    !COMMIT_PATTERN.test(sourceCommit) ||
    typeof repository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    throw new Error('Deployment provenance input is invalid');
  }
  const absoluteManifestPath = resolve(manifestPath);
  const manifest = await readFile(absoluteManifestPath);
  if (manifest.length === 0 || manifest.length > 4 * 1024 * 1024) {
    throw new Error('Deployment manifest size is invalid');
  }
  const record = {
    schema: 'life-os.deployment-provenance.v1',
    repository,
    source_commit: sourceCommit,
    manifest: {
      file_name: basename(absoluteManifestPath),
      byte_length: manifest.length,
      sha256: sha256(manifest),
    },
  };
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return Object.freeze(record);
}

/* node:coverage disable */
/** Runs the provenance CLI without accepting unbounded arguments. */
async function runCli() {
  const [manifestPath, outputPath, sourceCommit, repository, ...extra] =
    process.argv.slice(2);
  if (
    !manifestPath ||
    !outputPath ||
    !sourceCommit ||
    !repository ||
    extra.length
  ) {
    throw new Error(
      'Usage: create-provenance.mjs <manifest> <output> <commit> <repository>',
    );
  }
  await createDeploymentProvenance({
    manifestPath,
    outputPath,
    sourceCommit,
    repository,
  });
  process.stdout.write(`deployment_provenance=${resolve(outputPath)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli().catch((error) => {
    const message =
      error instanceof Error ? error.message : 'Deployment provenance failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
/* node:coverage enable */
