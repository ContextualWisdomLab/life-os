import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { AiRuntime } from './ai-runtime';
import type { ProposalAuditApplication } from './proposal-audit-application';
import {
  AI_RUNTIME,
  AiProductionModule,
  PROPOSAL_AUDIT_APPLICATION,
  PROPOSAL_SERVICE,
} from './main';

interface RuntimeProjectionProvider {
  readonly provide: symbol;
  readonly useFactory: (runtime: AiRuntime) => unknown;
}

/** Requires one factory provider from Nest module metadata. */
function requireRuntimeProjectionProvider(
  token: symbol,
): RuntimeProjectionProvider {
  const providers = Reflect.getMetadata(
    'providers',
    AiProductionModule,
  ) as unknown[];
  const provider = providers.find(
    (candidate): candidate is RuntimeProjectionProvider =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'provide' in candidate &&
      candidate.provide === token &&
      'useFactory' in candidate &&
      typeof candidate.useFactory === 'function',
  );
  if (!provider) {
    throw new Error('Expected AI production runtime projection provider');
  }
  return provider;
}

describe('AI production module providers', () => {
  it('projects one shared audit application through both narrowed tokens', () => {
    const application = {} as ProposalAuditApplication;
    const runtime = { application } as AiRuntime;

    expect(
      requireRuntimeProjectionProvider(PROPOSAL_SERVICE).useFactory(runtime),
    ).toBe(application);
    expect(
      requireRuntimeProjectionProvider(PROPOSAL_AUDIT_APPLICATION).useFactory(
        runtime,
      ),
    ).toBe(application);
    expect(
      requireRuntimeProjectionProvider(AI_RUNTIME).provide,
    ).toBe(AI_RUNTIME);
  });
});
