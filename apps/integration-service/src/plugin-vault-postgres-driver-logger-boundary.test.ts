import { describe, expect, it } from 'vitest';
import {
  createNodePostgresPluginPool,
  type NodePostgresPoolConstructor,
  type NodePostgresPoolLike,
} from './plugin-vault-postgres-driver';

function poolFixture(): {
  readonly constructor: NodePostgresPoolConstructor;
  emitIdleError(error: Error): void;
} {
  let idleErrorListener: ((error: Error) => void) | undefined;

  class FixturePool implements NodePostgresPoolLike {
    on(event: 'error', listener: (error: Error) => void): this {
      expect(event).toBe('error');
      idleErrorListener = listener;
      return this;
    }

    async query<Row>(): Promise<{
      readonly rows: readonly Row[];
      readonly rowCount: number | null;
    }> {
      return { rows: [], rowCount: 0 };
    }

    async end(): Promise<void> {
      return undefined;
    }
  }

  return {
    constructor: FixturePool,
    emitIdleError(error: Error): void {
      if (!idleErrorListener) {
        throw new Error('idle error listener was not registered');
      }
      idleErrorListener(error);
    },
  };
}

describe('Integration PostgreSQL idle-error telemetry boundary', () => {
  it('does not let a failing telemetry sink turn an idle-client failure into an uncaught process error', () => {
    const test = poolFixture();
    const credentialBearingNativeError = Object.assign(
      new Error('password=must-not-reach-process-error'),
      {
        name: 'DatabaseError',
        code: '57P01',
      },
    );

    createNodePostgresPluginPool(
      'postgresql://integration:secret@db.example.test:5432/life_os',
      test.constructor,
      () => {
        throw new Error('telemetry sink failure with secret-like detail');
      },
    );

    expect(() => test.emitIdleError(credentialBearingNativeError)).not.toThrow();
  });
});
