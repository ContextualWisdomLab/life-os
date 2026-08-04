import { describe, expect, it, vi } from 'vitest';

describe('AI process entrypoint', () => {
  it('delegates process startup to the tested bootstrap boundary', async () => {
    vi.resetModules();
    const bootstrapAiService = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./main', () => ({ bootstrapAiService }));

    await import('./server');

    expect(bootstrapAiService).toHaveBeenCalledOnce();
    vi.doUnmock('./main');
  });
});
