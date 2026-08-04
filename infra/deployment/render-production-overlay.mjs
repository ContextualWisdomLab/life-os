import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Exact application image keys supported by the production MSA reference. */
export const PRODUCTION_SERVICE_NAMES = Object.freeze([
  'web',
  'gateway',
  'identity-service',
  'planning-service',
  'habit-service',
  'review-service',
  'ai-service',
  'integration-calendar-service',
  'integration-service',
]);

const IMMUTABLE_IMAGE_PATTERN =
  /^(?<name>[a-z0-9](?:[a-z0-9._/:_-]*[a-z0-9])?)@(?<digest>sha256:[a-f0-9]{64})$/;
const MAXIMUM_IMAGE_REFERENCE_BYTES = 512;
const INVALID_IMAGE_MAP = 'Production image digest map is invalid';

/** Returns true only for an ordinary JSON object with no exotic prototype. */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}

/** Parses and validates the exact immutable image map used by the renderer. */
export function parseProductionImageMap(serializedMap) {
  if (
    typeof serializedMap !== 'string' ||
    Buffer.byteLength(serializedMap, 'utf8') > 32 * 1024
  ) {
    throw new Error(INVALID_IMAGE_MAP);
  }

  let parsed;
  try {
    parsed = JSON.parse(serializedMap);
  } catch {
    throw new Error(INVALID_IMAGE_MAP);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(INVALID_IMAGE_MAP);
  }

  const keys = Object.keys(parsed).sort();
  const expectedKeys = [...PRODUCTION_SERVICE_NAMES].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(INVALID_IMAGE_MAP);
  }

  const result = {};
  for (const serviceName of PRODUCTION_SERVICE_NAMES) {
    const imageReference = parsed[serviceName];
    if (
      typeof imageReference !== 'string' ||
      imageReference.length === 0 ||
      Buffer.byteLength(imageReference, 'utf8') > MAXIMUM_IMAGE_REFERENCE_BYTES ||
      /[\s\u0000-\u001f\u007f]/.test(imageReference) ||
      imageReference.includes('://')
    ) {
      throw new Error(INVALID_IMAGE_MAP);
    }
    const match = IMMUTABLE_IMAGE_PATTERN.exec(imageReference);
    if (!match) {
      throw new Error(INVALID_IMAGE_MAP);
    }
    result[serviceName] = Object.freeze({
      name: match.groups.name,
      digest: match.groups.digest,
      reference: imageReference,
    });
  }
  return Object.freeze(result);
}

/** Creates the canonical production Kustomization for one validated image map. */
export function renderProductionKustomization(imageMap) {
  const lines = [
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    'namespace: life-os',
    'resources:',
    '  - ../../base',
    'labels:',
    '  - pairs:',
    '      app.kubernetes.io/environment: production',
    'images:',
  ];

  for (const serviceName of PRODUCTION_SERVICE_NAMES) {
    const image = imageMap[serviceName];
    if (!image) {
      throw new Error(INVALID_IMAGE_MAP);
    }
    lines.push(
      `  - name: life-os/${serviceName}`,
      `    newName: ${image.name}`,
      `    digest: ${image.digest}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Reads the image map and writes a deterministic production overlay file. */
export async function writeProductionOverlay(imagesPath, outputPath) {
  const serializedMap = await readFile(imagesPath, 'utf8');
  const imageMap = parseProductionImageMap(serializedMap);
  const rendered = renderProductionKustomization(imageMap);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, { encoding: 'utf8', mode: 0o600 });
  return rendered;
}

/* node:coverage disable */
/** Parses the deliberately small command-line interface without accepting extras. */
function parseArguments(argumentsList) {
  if (
    argumentsList.length !== 4 ||
    argumentsList[0] !== '--images' ||
    argumentsList[2] !== '--output' ||
    !argumentsList[1] ||
    !argumentsList[3]
  ) {
    throw new Error(
      'Usage: render-production-overlay.mjs --images <json> --output <kustomization>',
    );
  }
  return {
    imagesPath: resolve(argumentsList[1]),
    outputPath: resolve(argumentsList[3]),
  };
}

/** Runs the renderer CLI and emits no image-map contents to standard output. */
async function runCli() {
  const { imagesPath, outputPath } = parseArguments(process.argv.slice(2));
  await writeProductionOverlay(imagesPath, outputPath);
  process.stdout.write(`production_overlay=${outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : INVALID_IMAGE_MAP;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
/* node:coverage enable */
