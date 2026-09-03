import {
  PluginCredentialApplication,
  type PluginCredentialBindingStore,
} from './plugin-credential';
import {
  PluginOperatorApplication,
  type PluginInstallationOperatorPort,
} from './plugin-operator-application';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';
import {
  PluginVaultSecretStore,
  type PluginVaultHttpClient,
} from './plugin-vault-secret-store';

const MINIMUM_OPERATOR_CONTEXT_SECRET_BYTES = 32;
const MAXIMUM_OPERATOR_CONTEXT_SECRET_BYTES = 8_192;
const MAXIMUM_CONFIGURATION_LENGTH = 8_192;

/** Operator-owned environment values accepted by the Plugin production composition boundary. */
export type PluginVaultOperatorEnvironment = Readonly<
  Record<string, string | undefined>
>;

/** Durable Plugin authorities that remain owned by Integration persistence/application layers. */
export interface PluginVaultOperatorDependencies {
  readonly installations: PluginInstallationOperatorPort;
  readonly bindingStore: PluginCredentialBindingStore;
  readonly replayGuard: PluginOperatorReplayGuardPort;
}

/** Fixed startup/composition failure that never reflects Vault or verifier secret configuration. */
export class PluginVaultOperatorCompositionError extends Error {
  /** Creates the only configuration failure exposed by this composition boundary. */
  constructor() {
    super('Plugin operator runtime configuration is unavailable');
    this.name = 'PluginVaultOperatorCompositionError';
  }
}

/** Terminates composition without reflecting malformed configuration or dependency values. */
function unavailable(): never {
  throw new PluginVaultOperatorCompositionError();
}

/** Requires a bounded environment mapping before any configuration field is read. */
function requireEnvironment(value: unknown): PluginVaultOperatorEnvironment {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return unavailable();
  }
  return value as PluginVaultOperatorEnvironment;
}

/** Reads one mandatory bounded operator-owned setting without trimming or echoing its value. */
function requireConfiguration(
  environment: PluginVaultOperatorEnvironment,
  name: string,
): string {
  const value = environment[name];
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_CONFIGURATION_LENGTH
  ) {
    return unavailable();
  }
  return value;
}

/** Validates the signed-operator verifier key early so hosted composition cannot start half-authorized. */
function requireOperatorContextSecret(value: string): string {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (
    bytes < MINIMUM_OPERATOR_CONTEXT_SECRET_BYTES ||
    bytes > MAXIMUM_OPERATOR_CONTEXT_SECRET_BYTES
  ) {
    return unavailable();
  }
  return value;
}

/** Requires the installation port methods needed by both operator and credential authority. */
function requireInstallations(
  value: unknown,
): PluginInstallationOperatorPort {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as PluginInstallationOperatorPort).install !== 'function' ||
    typeof (value as PluginInstallationOperatorPort).getInstallation !== 'function' ||
    typeof (value as PluginInstallationOperatorPort).revoke !== 'function'
  ) {
    return unavailable();
  }
  return value as PluginInstallationOperatorPort;
}

/** Requires the durable credential metadata operations before secret storage is composed. */
function requireBindingStore(value: unknown): PluginCredentialBindingStore {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as PluginCredentialBindingStore).findById !== 'function' ||
    typeof (value as PluginCredentialBindingStore).createIfAbsent !== 'function' ||
    typeof (value as PluginCredentialBindingStore).revokeActive !== 'function'
  ) {
    return unavailable();
  }
  return value as PluginCredentialBindingStore;
}

/** Requires durable one-time operator evidence consumption before request authority is granted. */
function requireReplayGuard(value: unknown): PluginOperatorReplayGuardPort {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as PluginOperatorReplayGuardPort).consume !== 'function'
  ) {
    return unavailable();
  }
  return value as PluginOperatorReplayGuardPort;
}

/**
 * Composes authenticated Plugin operator authority with Plugin-owned Vault secret storage.
 *
 * Vault origin, token, and mount plus the operator-context verifier key are read only
 * from the supplied operator-owned environment. Missing/malformed configuration fails
 * during composition with one credential-free error. The returned application derives
 * tenant/user authority from signed request evidence, consumes replay evidence durably,
 * and routes credential plaintext only through `PluginVaultSecretStore`; no secret value
 * is added to LifeOS persistence or returned in the credential view.
 *
 * PostgreSQL pool ownership remains outside this focused slice: callers supply the
 * already-constructed Integration-owned installation, credential-metadata, and replay
 * ports. A later hosted bootstrap slice can bind those ports to the service-owned pool
 * without making Vault or another bounded context a persistence owner.
 */
export function createPluginVaultOperatorApplication(
  dependencies: PluginVaultOperatorDependencies,
  environmentInput: PluginVaultOperatorEnvironment = process.env,
  http?: PluginVaultHttpClient,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  now: () => Date = () => new Date(),
): PluginOperatorApplication {
  if (
    dependencies === null ||
    typeof dependencies !== 'object' ||
    typeof nowSeconds !== 'function' ||
    typeof now !== 'function'
  ) {
    return unavailable();
  }
  const environment = requireEnvironment(environmentInput);
  const installations = requireInstallations(dependencies.installations);
  const bindingStore = requireBindingStore(dependencies.bindingStore);
  const replayGuard = requireReplayGuard(dependencies.replayGuard);
  const contextSecret = requireOperatorContextSecret(
    requireConfiguration(environment, 'INTEGRATION_OPERATOR_CONTEXT_SECRET'),
  );
  const origin = requireConfiguration(environment, 'PLUGIN_VAULT_ORIGIN');
  const token = requireConfiguration(environment, 'PLUGIN_VAULT_TOKEN');
  const mount = requireConfiguration(environment, 'PLUGIN_VAULT_MOUNT');

  let secretStore: PluginVaultSecretStore;
  try {
    secretStore = new PluginVaultSecretStore(origin, token, mount, http);
  } catch {
    return unavailable();
  }

  const credentials = new PluginCredentialApplication(
    installations,
    bindingStore,
    secretStore,
    now,
  );
  return new PluginOperatorApplication(
    installations,
    credentials,
    contextSecret,
    replayGuard,
    nowSeconds,
  );
}
