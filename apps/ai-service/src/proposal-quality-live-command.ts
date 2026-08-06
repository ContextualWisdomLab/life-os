import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  runProposalLiveConformance,
  validateProposalLiveConformanceReport,
  type ProposalLiveConformanceOptions,
  type ProposalLiveConformanceReport,
} from './proposal-quality-live-conformance';
import type { ContextualOrchestratorFetch } from './contextual-orchestrator-proposal-model';

const MAXIMUM_REPORT_PATH_LENGTH = 4_096;
const MAXIMUM_MODEL_LIST_LENGTH = 4_096;
const MAXIMUM_MODELS = 4;
const MODEL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;

/** Bounded environment accepted by the live-conformance command. */
export type ProposalLiveCommandEnvironment = Readonly<
  Record<string, string | undefined>
>;

/** Narrow file-system seam used for atomic-publication tests. */
export interface ProposalLiveCommandFileSystem {
  /** Creates the report directory when absent. */
  readonly mkdir: (
    path: string,
    options: { readonly recursive: true },
  ) => Promise<unknown>;
  /** Writes the complete temporary report with mode 0600. */
  readonly writeFile: (
    path: string,
    data: string,
    options: {
      readonly encoding: 'utf8';
      readonly mode: number;
      readonly flag: 'wx';
    },
  ) => Promise<void>;
  /** Atomically replaces the final report after validation. */
  readonly rename: (oldPath: string, newPath: string) => Promise<void>;
  /** Removes incomplete temporary evidence on failure. */
  readonly unlink: (path: string) => Promise<void>;
}

/** Deterministic dependencies used by the command and its tests. */
export interface ProposalLiveCommandDependencies {
  readonly fetcher?: ContextualOrchestratorFetch;
  readonly monotonicClock?: () => number;
  readonly evaluationClock?: () => Date;
  readonly uuidFactory?: () => string;
  readonly fileSystem?: ProposalLiveCommandFileSystem;
  readonly runConformance?: typeof runProposalLiveConformance;
}

/** Stable command failure that never retains provider, file, or response details. */
export class ProposalLiveCommandError extends Error {
  /** Creates one credential-free live-command failure. */
  constructor() {
    super('Proposal live conformance command failed');
    this.name = 'ProposalLiveCommandError';
  }
}

/** Raises the stable command failure. */
function invalid(): never {
  throw new ProposalLiveCommandError();
}

/** Requires one exact boolean marker. */
function enabled(value: string | undefined): boolean {
  return value === 'true';
}

/** Parses a bounded comma-separated explicit model inventory. */
export function parseProposalLiveModelInventory(
  value: string | undefined,
): readonly string[] {
  if (value === undefined || value.trim() === '') {
    return Object.freeze([]);
  }
  if (value.length > MAXIMUM_MODEL_LIST_LENGTH || /[\r\n\u0000]/u.test(value)) {
    return invalid();
  }
  const models = value.split(',').map((item) => item.trim());
  if (
    models.length > MAXIMUM_MODELS ||
    models.some(
      (model) => model === '' || !MODEL_IDENTIFIER_PATTERN.test(model),
    ) ||
    new Set(models).size !== models.length
  ) {
    return invalid();
  }
  return Object.freeze(models);
}

/** Requires one bounded absolute report path. */
function reportPath(value: string | undefined): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    value.length > MAXIMUM_REPORT_PATH_LENGTH ||
    /[\r\n\u0000]/u.test(value)
  ) {
    return invalid();
  }
  const absolute = resolve(value);
  if (absolute !== value) {
    return invalid();
  }
  return absolute;
}

/** Creates the complete report options from validated command input. */
function conformanceOptions(
  environment: ProposalLiveCommandEnvironment,
  dependencies: ProposalLiveCommandDependencies,
): ProposalLiveConformanceOptions {
  const liveEnabled = enabled(environment.AI_NIM_LIVE_CONFORMANCE_ENABLED);
  const providerCredentialAvailable =
    liveEnabled && enabled(environment.NVIDIA_NIM_API_KEY_AVAILABLE);
  return {
    lifeOsCommitSha: environment.LIFE_OS_COMMIT_SHA ?? '',
    contextualOrchestratorCommitSha:
      environment.CONTEXTUAL_ORCHESTRATOR_COMMIT_SHA ?? '',
    modelInventory: liveEnabled
      ? parseProposalLiveModelInventory(environment.NVIDIA_NIM_CHAT_MODELS)
      : Object.freeze([]),
    evaluatedAt:
      dependencies.evaluationClock?.() ??
      (environment.PROPOSAL_LIVE_EVALUATED_AT
        ? new Date(environment.PROPOSAL_LIVE_EVALUATED_AT)
        : new Date()),
    environment,
    providerCredentialAvailable,
    ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}),
    ...(dependencies.monotonicClock
      ? { monotonicClock: dependencies.monotonicClock }
      : {}),
  };
}

/** Returns the production file-system implementation. */
function productionFileSystem(): ProposalLiveCommandFileSystem {
  return Object.freeze({ mkdir, writeFile, rename, unlink });
}

/** Removes one temporary path while ignoring an absent file only. */
async function removeTemporary(
  fileSystem: ProposalLiveCommandFileSystem,
  path: string,
): Promise<void> {
  try {
    await fileSystem.unlink(path);
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

/** Atomically validates and publishes one credential-free JSON report. */
export async function publishProposalLiveConformanceReport(
  report: ProposalLiveConformanceReport,
  finalPath: string,
  fileSystem: ProposalLiveCommandFileSystem = productionFileSystem(),
  uuidFactory: () => string = randomUUID,
): Promise<void> {
  const validated = validateProposalLiveConformanceReport(report);
  const temporaryPath = `${finalPath}.temporary-${uuidFactory()}`;
  const payload = `${JSON.stringify(validated, null, 2)}\n`;
  await fileSystem.mkdir(dirname(finalPath), { recursive: true });
  try {
    await fileSystem.writeFile(temporaryPath, payload, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    const decoded = JSON.parse(payload) as unknown;
    validateProposalLiveConformanceReport(decoded);
    await fileSystem.rename(temporaryPath, finalPath);
  } catch {
    try {
      await removeTemporary(fileSystem, temporaryPath);
    } catch {
      // Cleanup is best-effort; the public error remains credential-free.
    }
    return invalid();
  }
}

/**
 * Runs the live conformance matrix or an explicit no-result preflight and
 * atomically publishes only validated credential-free evidence.
 */
export async function runProposalQualityLiveCommand(
  environment: ProposalLiveCommandEnvironment = process.env,
  dependencies: ProposalLiveCommandDependencies = {},
): Promise<ProposalLiveConformanceReport> {
  try {
    const finalPath = reportPath(environment.PROPOSAL_LIVE_REPORT_PATH);
    const runConformance =
      dependencies.runConformance ?? runProposalLiveConformance;
    const report = await runConformance(
      conformanceOptions(environment, dependencies),
    );
    await publishProposalLiveConformanceReport(
      report,
      finalPath,
      dependencies.fileSystem ?? productionFileSystem(),
      dependencies.uuidFactory ?? randomUUID,
    );
    return report;
  } catch (error) {
    if (error instanceof ProposalLiveCommandError) {
      throw error;
    }
    return invalid();
  }
}
