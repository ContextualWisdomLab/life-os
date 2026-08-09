import { describe, expect, it, vi } from 'vitest';
import {
  parsePrivacyServicePort,
  runPrivacyServiceWhenMain,
  startPrivacyService,
  type PrivacyNestApplication,
  type PrivacyNestFactory,
} from './server';
import { AppModule } from './main';

class RecordingApplication implements PrivacyNestApplication {
  readonly prefixes: string[] = [];
  shutdownHooksEnabled = 0;
  readonly listens: Array<{ port: number; host: string }> = [];

  setGlobalPrefix(prefix: string): void {
    this.prefixes.push(prefix);
  }

  enableShutdownHooks(): void {
    this.shutdownHooksEnabled += 1;
  }

  async listen(port: number, host: string): Promise<void> {
    this.listens.push({ port, host });
  }
}

describe('privacy service port parsing', () => {
  it('uses the default and one valid explicit port', () => {
    expect(parsePrivacyServicePort(undefined)).toBe(4108);
    expect(parsePrivacyServicePort('5108')).toBe(5108);
  });

  it.each(['', '0', '65536', '1.5', 'port', ' 4108', '4108\n'])(
    'rejects invalid port %#',
    (value) => {
      expect(() => parsePrivacyServicePort(value)).toThrow(
        'Privacy service port is invalid',
      );
    },
  );
});

describe('privacy service bootstrap', () => {
  it('creates one versioned shutdown-aware listener', async () => {
    const application = new RecordingApplication();
    const factory = vi.fn<PrivacyNestFactory>(async (module) => {
      expect(module).toBe(AppModule);
      return application;
    });

    await expect(
      startPrivacyService({ PRIVACY_SERVICE_PORT: '5108' }, factory),
    ).resolves.toBe(application);
    expect(application.prefixes).toEqual(['v1']);
    expect(application.shutdownHooksEnabled).toBe(1);
    expect(application.listens).toEqual([{ port: 5108, host: '0.0.0.0' }]);
  });

  it('uses the production default port when omitted', async () => {
    const application = new RecordingApplication();
    await startPrivacyService({}, async () => application);
    expect(application.listens).toEqual([{ port: 4108, host: '0.0.0.0' }]);
  });
});

describe('main-module process guard', () => {
  it('starts only when the compiled module is the process entrypoint', async () => {
    const start = vi.fn(async () => undefined);
    runPrivacyServiceWhenMain(false, start);
    expect(start).not.toHaveBeenCalled();
    runPrivacyServiceWhenMain(true, start);
    expect(start).toHaveBeenCalledOnce();
    await start.mock.results[0]?.value;
  });
});
