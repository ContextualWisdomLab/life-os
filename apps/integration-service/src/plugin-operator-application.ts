import type {
  BindPluginCredentialInput,
  PluginCredentialBindingView,
} from './plugin-credential';
import type {
  GrantPluginDeliveryOriginInput,
  PluginDeliveryOriginGrantRecord,
} from './plugin-delivery-origin-authority';
import type {
  InstallPluginInput,
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';
import {
  IntegrationOperatorContextError,
  PLUGIN_OPERATOR_CONTEXT_MAXIMUM_AGE_SECONDS,
  requireVerifiedPluginOperatorContext,
  type IntegrationOperatorContextHeaders,
} from './plugin-operator-context';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';

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

/** Delivery-origin lifecycle authority consumed only after exact signed operator verification. */
export interface PluginDeliveryOriginOperatorPort {
  /** Grants one exact HTTPS origin inside authenticated installation authority. */
  grant(
    trustedContext: PluginInstallationContext,
    installationId: string,
    input: GrantPluginDeliveryOriginInput,
  ): Promise<PluginDeliveryOriginGrantRecord>;
  /** Reads one exact durable origin grant inside authenticated installation authority. */
  getGrant(
    trustedContext: PluginInstallationContext,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined>;
  /** Revokes one exact durable origin grant inside authenticated installation authority. */
  revoke(
    trustedContext: PluginInstallationContext,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord>;
}

/** Fixed dependency failure that never discloses credential material or provider details. */
export class PluginOperatorDependencyError extends Error {
  /** Creates the bounded failure returned when credential composition is unavailable. */
  constructor() {
    super('Plugin credential capability is unavailable');
    this.name = 'PluginOperatorDependencyError';
  }
}

/** Fixed dependency failure that does not reveal delivery-origin persistence details. */
export class PluginDeliveryOriginOperatorDependencyError extends Error {
  /** Creates the bounded failure returned when delivery-origin composition is unavailable. */
  constructor() {
    super('Plugin delivery-origin capability is unavailable');
    this.name = 'PluginDeliveryOriginOperatorDependencyError';
  }
}

/** Operator-selected installation fields; authenticated authority is never accepted from the body. */
export type PluginOperatorInstallInput = Omit<
  InstallPluginInput,
  'trustedContext'
>;

/** Operator-selected credential fields; authenticated authority is never accepted from the body. */
export type PluginOperatorCredentialInput = Omit<
  BindPluginCredentialInput,
  'trustedContext'
>;

/** Converts a verified Unix second to one canonical persistence instant or fails closed. */
function canonicalInstant(seconds: number): string {
  const value = new Date(seconds * 1_000);
  if (!Number.isFinite(value.getTime())) {
    throw new IntegrationOperatorContextError('unavailable');
  }
  return value.toISOString();
}

/**
 * Composes cryptographically verified operator identity with host-owned plugin
 * installation, credential, and delivery-origin applications.
 *
 * Every method constructs the exact server-owned method/path binding before any
 * downstream authority is invoked. Tenant/user identifiers are derived only from
 * the signed gateway context; request bodies and dynamic identifiers cannot widen
 * that authority. Signed UUIDv4 evidence is atomically consumed through a
 * service-owned replay guard before lifecycle authority is granted, so separate
 * service instances cannot independently accept the same request evidence.
 */
export class PluginOperatorApplication {
  /** Creates the operator boundary over host-owned lifecycle, replay, and verifier state. */
  constructor(
    private readonly installations: PluginInstallationOperatorPort,
    private readonly credentials: PluginCredentialOperatorPort | undefined,
    private readonly contextSecret: unknown,
    private readonly replayGuard: PluginOperatorReplayGuardPort | undefined,
    private readonly nowSeconds: () => number = () =>
      Math.floor(Date.now() / 1000),
    private readonly deliveryOrigins?: PluginDeliveryOriginOperatorPort,
  ) {}

  /** Installs a plugin only under a signed POST collection authority. */
  async install(
    headers: IntegrationOperatorContextHeaders,
    input: PluginOperatorInstallInput,
  ): Promise<PluginInstallationRecord> {
    const trustedContext = await this.requireContext(
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
    const trustedContext = await this.requireContext(
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
    const trustedContext = await this.requireContext(
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
    const trustedContext = await this.requireContext(
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
    const trustedContext = await this.requireContext(
      headers,
      'POST',
      `/v1/plugins/credential-bindings/${credentialBindingId}/revoke`,
    );
    return this.requireCredentials().revoke(
      trustedContext,
      credentialBindingId,
    );
  }

  /** Grants one exact delivery origin only under its installation-scoped signed POST authority. */
  async grantDeliveryOrigin(
    headers: IntegrationOperatorContextHeaders,
    installationId: string,
    input: GrantPluginDeliveryOriginInput,
  ): Promise<PluginDeliveryOriginGrantRecord> {
    const trustedContext = await this.requireContext(
      headers,
      'POST',
      `/v1/plugins/installations/${installationId}/delivery-origins`,
    );
    return this.requireDeliveryOrigins().grant(
      trustedContext,
      installationId,
      input,
    );
  }

  /** Reads one delivery-origin grant only under its exact signed dynamic GET authority. */
  async getDeliveryOrigin(
    headers: IntegrationOperatorContextHeaders,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined> {
    const trustedContext = await this.requireContext(
      headers,
      'GET',
      `/v1/plugins/installations/${installationId}/delivery-origins/${grantId}`,
    );
    return this.requireDeliveryOrigins().getGrant(
      trustedContext,
      installationId,
      grantId,
    );
  }

  /** Revokes one delivery-origin grant only under its exact signed dynamic POST authority. */
  async revokeDeliveryOrigin(
    headers: IntegrationOperatorContextHeaders,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord> {
    const trustedContext = await this.requireContext(
      headers,
      'POST',
      `/v1/plugins/installations/${installationId}/delivery-origins/${grantId}/revoke`,
    );
    return this.requireDeliveryOrigins().revoke(
      trustedContext,
      installationId,
      grantId,
    );
  }

  /** Verifies and atomically consumes one signed request identity before downstream authority. */
  private async requireContext(
    headers: IntegrationOperatorContextHeaders,
    method: 'GET' | 'POST',
    path: string,
  ): Promise<PluginInstallationContext> {
    const nowSeconds = this.nowSeconds();
    const verified = requireVerifiedPluginOperatorContext(
      headers,
      this.contextSecret,
      { method, path },
      nowSeconds,
    );
    if (!this.replayGuard) {
      throw new IntegrationOperatorContextError('unavailable');
    }
    const evidence = Object.freeze({
      evidenceId: verified.evidenceId,
      consumedAt: canonicalInstant(nowSeconds),
      expiresAt: canonicalInstant(
        verified.issuedAtSeconds + PLUGIN_OPERATOR_CONTEXT_MAXIMUM_AGE_SECONDS,
      ),
    });
    let consumed: boolean;
    try {
      consumed = await this.replayGuard.consume(evidence);
    } catch {
      throw new IntegrationOperatorContextError('unavailable');
    }
    if (!consumed) {
      throw new IntegrationOperatorContextError('invalid');
    }
    return verified.trustedContext;
  }

  /** Returns configured credential authority only after caller authentication succeeds. */
  private requireCredentials(): PluginCredentialOperatorPort {
    if (!this.credentials) {
      throw new PluginOperatorDependencyError();
    }
    return this.credentials;
  }

  /** Returns configured delivery-origin authority only after caller authentication succeeds. */
  private requireDeliveryOrigins(): PluginDeliveryOriginOperatorPort {
    if (!this.deliveryOrigins) {
      throw new PluginDeliveryOriginOperatorDependencyError();
    }
    return this.deliveryOrigins;
  }
}
