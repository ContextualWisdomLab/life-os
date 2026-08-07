import { describe, expect, it, vi } from 'vitest';
import { startProposalQualityLiveCli } from './proposal-quality-live-cli';

describe('proposal quality live CLI', () => {
  it('does nothing when imported as a library module', () => {
    const command = vi.fn(async () => undefined);
    const processSurface: { exitCode?: number } = {};
    const logger = vi.fn<(message: string) => void>();

    expect(
      startProposalQualityLiveCli(false, command, processSurface, logger),
    ).toBeUndefined();
    expect(command).not.toHaveBeenCalled();
    expect(processSurface.exitCode).toBeUndefined();
    expect(logger).not.toHaveBeenCalled();
  });

  it('runs one executable command without changing successful exit state', async () => {
    const command = vi.fn(async () => ({ status: 'completed' }));
    const processSurface: { exitCode?: number } = {};
    const logger = vi.fn<(message: string) => void>();

    await expect(
      startProposalQualityLiveCli(true, command, processSurface, logger),
    ).resolves.toBeUndefined();
    expect(command).toHaveBeenCalledOnce();
    expect(command).toHaveBeenCalledWith();
    expect(processSurface.exitCode).toBeUndefined();
    expect(logger).not.toHaveBeenCalled();
  });

  it('maps rejection to one credential-free message and nonzero exit code', async () => {
    const command = vi.fn(async () => {
      throw new Error('provider-key=secret-value');
    });
    const processSurface: { exitCode?: number } = {};
    const logger = vi.fn<(message: string) => void>();

    await expect(
      startProposalQualityLiveCli(true, command, processSurface, logger),
    ).resolves.toBeUndefined();
    expect(processSurface.exitCode).toBe(1);
    expect(logger).toHaveBeenCalledWith(
      'Proposal live conformance command failed',
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret-value');
  });
});
