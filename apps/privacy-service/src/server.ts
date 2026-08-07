import { NestFactory } from '@nestjs/core';
import { AppModule } from './main';

/** Minimal Nest application methods required by the process bootstrap. */
export interface PrivacyNestApplication {
  /** Applies one version prefix to every public route. */
  setGlobalPrefix(prefix: string): void;
  /** Registers framework lifecycle hooks for process shutdown. */
  enableShutdownHooks(): void;
  /** Starts one network listener. */
  listen(port: number, host: string): Promise<void>;
}

/** Factory seam that creates one privacy-service Nest application. */
export type PrivacyNestFactory = (
  module: typeof AppModule,
) => Promise<PrivacyNestApplication>;

/** Parses the optional privacy-service port into the valid TCP range. */
export function parsePrivacyServicePort(value: string | undefined): number {
  if (value === undefined) {
    return 4108;
  }
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error('Privacy service port is invalid');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error('Privacy service port is invalid');
  }
  return port;
}

const productionFactory: PrivacyNestFactory = async (module) =>
  await NestFactory.create(module);

/** Creates and starts one versioned independently deployable privacy service. */
export async function startPrivacyService(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  factory: PrivacyNestFactory = productionFactory,
): Promise<PrivacyNestApplication> {
  const application = await factory(AppModule);
  application.setGlobalPrefix('v1');
  application.enableShutdownHooks();
  await application.listen(
    parsePrivacyServicePort(environment.PRIVACY_SERVICE_PORT),
    '0.0.0.0',
  );
  return application;
}

/** Starts a supplied operation only when this module is the process entrypoint. */
export function runPrivacyServiceWhenMain(
  isMain: boolean,
  start: () => Promise<unknown>,
): void {
  if (isMain) {
    void start();
  }
}

runPrivacyServiceWhenMain(require.main === module, startPrivacyService);
