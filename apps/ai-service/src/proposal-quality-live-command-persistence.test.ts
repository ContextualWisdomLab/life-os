import { describe, expect, it, vi } from 'vitest';
import {
  ProposalLiveCommandError,
  publishProposalLiveConformanceReport,
  type ProposalLiveCommandFileSystem,
} from './proposal-quality-live-command';
import {
  runProposalLiveConformance,
  type ProposalLiveConformanceReport,
} from './proposal-quality-live-conformance';

const FINAL_PATH = '/tmp/life-os-live-conformance/report.json';
type ReadFileOperation = NonNullable<ProposalLiveCommandFileSystem['readFile']>;

/** Creates one valid report without provider traffic. */
async function validReport(): Promise<ProposalLiveConformanceReport> {
  return await runProposalLiveConformance({
    lifeOsCommitSha: 'a'.repeat(40),
    contextualOrchestratorCommitSha: 'b'.repeat(40),
    modelInventory: ['model-a'],
    evaluatedAt: new Date('2026-08-06T07:00:00.000Z'),
    providerCredentialAvailable: false,
    environment: {},
  });
}

/** Creates a file-system seam whose persisted read can differ from the write input. */
function fileSystem(persisted: string): {
  readonly seam: ProposalLiveCommandFileSystem;
  readonly readFile: ReturnType<typeof vi.fn<ReadFileOperation>>;
  readonly rename: ReturnType<
    typeof vi.fn<ProposalLiveCommandFileSystem['rename']>
  >;
  readonly unlink: ReturnType<
    typeof vi.fn<ProposalLiveCommandFileSystem['unlink']>
  >;
} {
  const readFile = vi.fn<ReadFileOperation>(async () => persisted);
  const rename = vi.fn<ProposalLiveCommandFileSystem['rename']>(
    async () => undefined,
  );
  const unlink = vi.fn<ProposalLiveCommandFileSystem['unlink']>(
    async () => undefined,
  );
  return {
    seam: {
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      readFile,
      rename,
      unlink,
    },
    readFile,
    rename,
    unlink,
  };
}

describe('atomic live report persisted-content validation', () => {
  it('reads and validates the temporary file before the atomic rename', async () => {
    const report = await validReport();
    const persisted = `${JSON.stringify(report)}\n`;
    const fs = fileSystem(persisted);

    await publishProposalLiveConformanceReport(
      report,
      FINAL_PATH,
      fs.seam,
      () => 'persisted-read-token',
    );

    const temporaryPath = `${FINAL_PATH}.temporary-persisted-read-token`;
    expect(fs.readFile).toHaveBeenCalledWith(temporaryPath, 'utf8');
    expect(fs.rename).toHaveBeenCalledWith(temporaryPath, FINAL_PATH);
  });

  it('rejects corrupted persisted content and removes it without renaming', async () => {
    const report = await validReport();
    const fs = fileSystem('{"schema":"corrupted"}');

    await expect(
      publishProposalLiveConformanceReport(
        report,
        FINAL_PATH,
        fs.seam,
        () => 'corrupted-read-token',
      ),
    ).rejects.toEqual(new ProposalLiveCommandError());

    const temporaryPath = `${FINAL_PATH}.temporary-corrupted-read-token`;
    expect(fs.readFile).toHaveBeenCalledWith(temporaryPath, 'utf8');
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledWith(temporaryPath);
  });
});
