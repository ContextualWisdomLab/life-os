import type {
  BindPluginCredentialInput,
  PluginCredentialBindingView,
} from './plugin-credential';
import type {
  InstallPluginInput,
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';
import {
  requireTrustedPluginOperatorContext,
  type IntegrationOperatorContextHeaders,
} from './plugin-operator-context';

/** Installation lifecycle authority consumed after signed operator verification. */
export interface PluginInstallationOperatorPort {
  /** Installs only with trusted tenant/user context supplied by this application boundary. */
  install(input: InstallPluginInput): Promise<PluginInstallationRecord>;
  /** Reads one installer-owned installation inside trusted tenant/user authority. */
  getInstallation(
    trustedContext: PluginInstallationContext,
    installationId: string,
  ): Promise<PluginInstallationRecord | undefined>;
  /** Revokes one installer-owned installation inside trusted tenant/user authority. */
  revoke(
    trustedContext: PluginInstallationContext,
    installationId: string,
  ): Promise<PluginInstallationRecord>;
}

/** Credential lifecycle authority consumed after signed operator verification. */
export interface PluginCredentialOperatorPort {
  /** Binds secret material only after authenticated installation authority is derived. */
  bind(input: BindPluginCredentialInput): Promise<PluginCredentialBindingView>;
  /** Revokes one installer-owned credential binding inside trusted tenant/user authority. */
  revoke(
    trustedContext: PluginInstallationContext,
    credentialBindingId: string,
  ): Promise<PluginCredentialBindingView>;
}

/** Fixed dependency failure that never discloses credential material or provider details. */
export class PluginOperatorDependencyError extends Error {
  /** Creates the bounded failure returned when credential composition is unavailable. */
  constructor() {
    super('Plugin credential capability is unavailable');
    this.name = 'PluginOperatorDependencyError';
  }
}

/** Operator-selected installation fields; authenticated authority is never accepted from the body. */
export type PluginOperatorInstallInput = Omit<InstallPluginInput, 'trustedContext'>;

/** Operator-selected credential fields; authenticated authority is never accepted from the body. */
export type PluginOperatorCredentialInput = Omit<
  BindPluginCredentialInput,
  'trustedContext'
>;

/**
 * Composes cryptographically verified operator identity with host-owned plugin
 * installation and credential applications.
 *
 * Every method constructs the exact server-owned method/path binding before any
 * downstream authority is invoked. Tenant/user identifiers are derived only from
 * the signed gateway context; request bodies and dynamic identifiers cannot widen
 * that authority. Optional credential composition is checked only after context
 * verification so an unauthenticated caller cannot probe provider availability.
 */
export class PluginOperatorApplication {
  /** Creates the operator boundary over host-owned lifecycle applications and verifier state. */
  constructor(
    private readonly installations: PluginInstallationOperatorPort,
    private readonly credentials: PluginCredentialOperatorPort | undefined,
    private readonly contextSecret: unknown,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Installs a plugin only under a signed POST collection authority. */
  async install(
    headers: IntegrationOperatorContextHeaders,
    input: PluginOperatorInstallInput,
  ): Promise<PluginInstallationRecord> {
    const trustedContext = this.requireContext(
      headers,
      'POST',
      '/v1/plugins/installations',
    );
    return this.installations.install({ ...input, trustedContext });
  }

  /** Reads one installation only under the exact signed dynamic GET authority. */
  async getInstallation(
    headers: IntegrationOperatorContextHeaders,
    installationId: string,
  ): Promise<PluginInstallationRecord | undefined> {
    const trustedContext = this.requireContext(
      headers,
      'GET',
      `/v1/plugins/installations/${installationId}`,
    );
    return this.installations.getInstallation(trustedContext, installationId);
  }

  /** Revokes one installation only under the exact signed dynamic POST authority. */
  async revokeInstallation(
    headers: IntegrationOperatorContextHeaders,
    installationId: string,
  ): Promise<PluginInstallationRecord> {
    const trustedContext = this.requireContext(
      headers,
      'POST',
      `/v1/plugins/installations/${installationId}/revoke`,
    );
    return this.installations.revoke(trustedContext, installationId);
  }

  /** Binds a credential only after exact signed authority and configured host secret storage. */
  async bindCredential(
    headers: IntegrationOperatorContextHeaders,
    input: PluginOperatorCredentialInput,
  ): Promise<PluginCredentialBindingView> {
    const trustedContext = this.requireContext(
      headers,
      'POST',
      '/v1/plugins/credential-bindings',
    );
    const credentials = this.requireCredentials();
    return credentials.bind({ ...input, trustedContext });
  }

  /** Revokes a credential only under the exact signed dynamic POST authority. */
  async revokeCredential(
    headers: IntegrationOperatorContextHeaders,
    credentialBindingId: string,
  ): Promise<PluginCredentialBindingView> {
    const trustedContext = this.requireContext(
      headers,
      'POST',
      `/v1/plugins/credential-bindings/${credentialBindingId}/revoke`,
    );
    return this.requireCredentials().revoke(
      trustedContext,
      credentialBindingId,
    );
  }

  /** Verifies signed tenant/user authority against one server-owned request identity. */
  private requireContext(
    headers: IntegrationOperatorContextHeaders,
    method: 'GET' | 'POST',
    path: string,
  ): PluginInstallationContext {
    return requireTrustedPluginOperatorContext(
      headers,
      this.contextSecret,
      { method, path },
      this.nowSeconds(),
    );
  }

  /** Returns configured credential authority only after caller authentication succeeds. */
  private requireCredentials(): PluginCredentialOperatorPort {
    if (!this.credentials) {
      throw new PluginOperatorDependencyError();
    }
    return this.credentials;
  }
}
