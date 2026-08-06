import {
  runProposalQualityLiveCommand,
  type ProposalLiveCommandEnvironment,
} from './proposal-quality-live-command';

/** Minimal command contract injected by deterministic CLI tests. */
export type ProposalQualityLiveCommand = (
  environment?: ProposalLiveCommandEnvironment,
) => Promise<unknown>;

/** Minimal process surface used to report one fixed failure without details. */
export interface ProposalQualityLiveProcess {
  exitCode?: string | number | null | undefined;
}

/** Minimal credential-free logger used only at the executable boundary. */
export type ProposalQualityLiveErrorLogger = (message: string) => void;

/**
 * Starts the live-conformance command only for the executable module and maps
 * every rejection to one fixed message and nonzero process exit code.
 */
export function startProposalQualityLiveCli(
  isEntrypoint: boolean,
  command: ProposalQualityLiveCommand = runProposalQualityLiveCommand,
  processSurface: ProposalQualityLiveProcess = process,
  errorLogger: ProposalQualityLiveErrorLogger = console.error,
): Promise<void> | undefined {
  if (!isEntrypoint) {
    return undefined;
  }
  return command().then(
    () => undefined,
    () => {
      errorLogger('Proposal live conformance command failed');
      processSurface.exitCode = 1;
    },
  );
}

void startProposalQualityLiveCli(require.main === module);
