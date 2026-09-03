import { isIP } from 'node:net';
import type {
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONTROL_OR_SEPARATOR_PATTERN = /[\p{Cc}\p{Z}]/u;
/** Pre-filters an HTTPS authority with no path except one optional trailing slash before URL parsing. */
const AUTHORITY_ONLY_HTTPS_ORIGIN_PATTERN = /^https:\/\/[^/?#\\]+\/?$/iu;
const MAXIMUM_ORIGIN_LENGTH = 512;
const AUTHORITY_VERSION = 'life-os.plugin-delivery-origin.v1' as const;

/** Fixed fail-closed delivery-origin authority failure without input reflection. */
export class PluginDeliveryOriginAuthorityError extends Error {
  /** Creates a credential-free authority failure. */
  constructor() {
    super('Plugin delivery origin authority is invalid');
    this.name = 'PluginDeliveryOriginAuthorityError';
  }
}

/**
 * Durable host-owned permission for one installation to target one exact HTTPS origin.
 *
 * The record is scoped by installation, workspace, and granting user. An active
 * record authorizes only origin identity; it does not itself authorize network
 * transport, DNS resolution, redirects, credentials, or payload contents.
 */
export interface PluginDeliveryOriginGrantRecord {
  readonly authorityVersion: typeof AUTHORITY_VERSION;
  readonly grantId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly grantedByUserId: string;
  readonly origin: string;
  readonly status: 'active' | 'revoked';
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

/**
 * Atomic revocation command for one host-owned grant inside its full authority scope.
 *
 * Exact replay may return the same durable revoked record. The command never
 * broadens scope and cannot reactivate a revoked grant.
 */
export interface RevokePluginDeliveryOriginGrant {
  readonly grantId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly grantedByUserId: string;
  readonly revokedAt: string;
}

/**
 * Service-owned persistence port for delivery-origin grants.
 *
 * Implementations must preserve opaque identity, workspace/user scope, and
 * lifecycle state. Create and revoke operations are replay-safe and return the
 * durable winner so the application can verify that persistence did not change
 * authority semantics.
 */
export interface PluginDeliveryOriginGrantStore {
  /** Creates one grant or returns the durable winner for its opaque identity. */
  createIfAbsent(
    record: PluginDeliveryOriginGrantRecord,
  ): Promise<PluginDeliveryOriginGrantRecord>;
  /** Reads one grant only inside exact installation/workspace/user authority. */
  findById(
    grantId: string,
    installationId: string,
    workspaceId: string,
    grantedByUserId: string,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined>;
  /** Revokes one active grant or returns its exact durable replay. */
  revokeActive(
    input: RevokePluginDeliveryOriginGrant,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined>;
}

/**
 * Read-only installation authority needed before a delivery origin can be granted.
 *
 * The reader must resolve only the exact authenticated workspace/user scope. A
 * returned record remains untrusted until this boundary revalidates its opaque
 * installation identity and active lifecycle state.
 */
export interface PluginInstallationAuthorityReader {
  /** Reads one installation only inside exact authenticated workspace/user scope. */
  findById(
    installationId: string,
    workspaceId: string,
    installedByUserId: string,
  ): Promise<PluginInstallationRecord | undefined>;
}

/**
 * Host request to create one delivery-origin grant.
 *
 * `grantId` is opaque UUIDv4 replay identity and `origin` is untrusted request
 * material. Neither field conveys tenant or installation ownership.
 */
export interface GrantPluginDeliveryOriginInput {
  readonly grantId: string;
  readonly origin: string;
}

function invalid(): never {
  throw new PluginDeliveryOriginAuthorityError();
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

function requireInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalid();
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    return invalid();
  }
  return value;
}

function currentInstant(now: () => Date): string {
  try {
    return requireInstant(now().toISOString());
  } catch {
    return invalid();
  }
}

function requireContext(
  context: PluginInstallationContext,
): PluginInstallationContext {
  return Object.freeze({
    workspaceId: requireUuidV4(context.workspaceId),
    actorUserId: requireUuidV4(context.actorUserId),
  });
}

/**
 * Accepts only a non-null object envelope before reading untrusted grant fields.
 *
 * Arrays and primitive values fail closed so malformed input cannot reach
 * installation lookup or grant persistence through native property-access errors.
 */
function requireGrantInput(value: unknown): GrantPluginDeliveryOriginInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  return value as GrantPluginDeliveryOriginInput;
}

function normalizeOrigin(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 9 ||
    value.length > MAXIMUM_ORIGIN_LENGTH ||
    CONTROL_OR_SEPARATOR_PATTERN.test(value) ||
    !AUTHORITY_ONLY_HTTPS_ORIGIN_PATTERN.test(value)
  ) {
    return invalid();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid();
  }
  const hostname =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    hostname === '' ||
    isIP(hostname) !== 0 ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.port === '0' ||
    parsed.origin.length > MAXIMUM_ORIGIN_LENGTH
  ) {
    return invalid();
  }
  return parsed.origin;
}

function freezeRecord(
  record: PluginDeliveryOriginGrantRecord,
): PluginDeliveryOriginGrantRecord {
  return Object.freeze({ ...record });
}

function requireRecord(record: unknown): PluginDeliveryOriginGrantRecord {
  if (record === null || typeof record !== 'object') {
    return invalid();
  }
  const candidate = record as PluginDeliveryOriginGrantRecord;
  if (candidate.authorityVersion !== AUTHORITY_VERSION) {
    return invalid();
  }
  const grantId = requireUuidV4(candidate.grantId);
  const installationId = requireUuidV4(candidate.installationId);
  const workspaceId = requireUuidV4(candidate.workspaceId);
  const grantedByUserId = requireUuidV4(candidate.grantedByUserId);
  const origin = normalizeOrigin(candidate.origin);
  const grantedAt = requireInstant(candidate.grantedAt);
  const revokedAt =
    candidate.revokedAt === null
      ? null
      : requireInstant(candidate.revokedAt);
  if (
    candidate.grantId !== grantId ||
    candidate.installationId !== installationId ||
    candidate.workspaceId !== workspaceId ||
    candidate.grantedByUserId !== grantedByUserId ||
    origin !== candidate.origin ||
    (candidate.status === 'active' && revokedAt !== null) ||
    (candidate.status === 'revoked' && revokedAt === null) ||
    (revokedAt !== null &&
      new Date(revokedAt).getTime() < new Date(grantedAt).getTime())
  ) {
    return invalid();
  }
  if (candidate.status !== 'active' && candidate.status !== 'revoked') {
    return invalid();
  }
  return freezeRecord({
    authorityVersion: AUTHORITY_VERSION,
    grantId,
    installationId,
    workspaceId,
    grantedByUserId,
    origin,
    status: candidate.status,
    grantedAt,
    revokedAt,
  });
}

function requireActiveInstallation(
  context: PluginInstallationContext,
  installationId: string,
  installation: PluginInstallationRecord,
  authorityInstant: string,
): PluginInstallationRecord {
  const installedAt = requireInstant(installation.installedAt);
  if (
    installation.installationId !== installationId ||
    installation.installationId !==
      requireUuidV4(installation.installationId) ||
    installation.workspaceId !== context.workspaceId ||
    installation.installedByUserId !== context.actorUserId ||
    installation.status !== 'active' ||
    installation.revokedAt !== null ||
    new Date(installedAt).getTime() > new Date(authorityInstant).getTime()
  ) {
    return invalid();
  }
  return installation;
}

function sameActiveGrant(
  durable: PluginDeliveryOriginGrantRecord,
  candidate: PluginDeliveryOriginGrantRecord,
): boolean {
  return (
    durable.authorityVersion === candidate.authorityVersion &&
    durable.grantId === candidate.grantId &&
    durable.installationId === candidate.installationId &&
    durable.workspaceId === candidate.workspaceId &&
    durable.grantedByUserId === candidate.grantedByUserId &&
    durable.origin === candidate.origin &&
    durable.status === 'active' &&
    durable.revokedAt === null &&
    new Date(durable.grantedAt).getTime() <=
      new Date(candidate.grantedAt).getTime()
  );
}

/**
 * Owns delivery-origin grants independently from plugin manifest intent.
 *
 * This boundary records only an exact host-approved HTTPS origin. It does not
 * perform network delivery and therefore does not replace the later DNS/IP,
 * redirect, proxy, timeout, byte-limit or connect-time egress enforcement.
 */
export class PluginDeliveryOriginAuthority {
  /** Creates the authority boundary over service-owned persistence ports. */
  constructor(
    private readonly store: PluginDeliveryOriginGrantStore,
    private readonly installations: PluginInstallationAuthorityReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Creates an origin grant only after validating actor input and durable installation authority. */
  async grant(
    trustedContext: PluginInstallationContext,
    installationIdInput: string,
    input: GrantPluginDeliveryOriginInput,
  ): Promise<PluginDeliveryOriginGrantRecord> {
    const context = requireContext(trustedContext);
    const installationId = requireUuidV4(installationIdInput);
    const request = requireGrantInput(input);
    const grantId = requireUuidV4(request.grantId);
    const origin = normalizeOrigin(request.origin);
    const installationEvidence = await this.installations.findById(
      installationId,
      context.workspaceId,
      context.actorUserId,
    );
    if (!installationEvidence) {
      return invalid();
    }
    const grantedAt = currentInstant(this.now);
    const installation = requireActiveInstallation(
      context,
      installationId,
      installationEvidence,
      grantedAt,
    );
    const candidate = freezeRecord({
      authorityVersion: AUTHORITY_VERSION,
      grantId,
      installationId: installation.installationId,
      workspaceId: context.workspaceId,
      grantedByUserId: context.actorUserId,
      origin,
      status: 'active',
      grantedAt,
      revokedAt: null,
    });
    const durable = requireRecord(await this.store.createIfAbsent(candidate));
    if (!sameActiveGrant(durable, candidate)) {
      return invalid();
    }
    return durable;
  }

  /** Reads one grant only inside exact authenticated host authority. */
  async getGrant(
    trustedContext: PluginInstallationContext,
    installationIdInput: string,
    grantIdInput: string,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined> {
    const context = requireContext(trustedContext);
    const installationId = requireUuidV4(installationIdInput);
    const grantId = requireUuidV4(grantIdInput);
    const existing = await this.store.findById(
      grantId,
      installationId,
      context.workspaceId,
      context.actorUserId,
    );
    if (
      !existing ||
      existing.grantId !== grantId ||
      existing.installationId !== installationId ||
      existing.workspaceId !== context.workspaceId ||
      existing.grantedByUserId !== context.actorUserId
    ) {
      return undefined;
    }
    return requireRecord(existing);
  }

  /** Revokes future use while preserving the durable authority lifecycle. */
  async revoke(
    trustedContext: PluginInstallationContext,
    installationIdInput: string,
    grantIdInput: string,
  ): Promise<PluginDeliveryOriginGrantRecord> {
    const context = requireContext(trustedContext);
    const installationId = requireUuidV4(installationIdInput);
    const grantId = requireUuidV4(grantIdInput);
    const durable = await this.store.revokeActive({
      grantId,
      installationId,
      workspaceId: context.workspaceId,
      grantedByUserId: context.actorUserId,
      revokedAt: currentInstant(this.now),
    });
    if (
      !durable ||
      durable.grantId !== grantId ||
      durable.installationId !== installationId ||
      durable.workspaceId !== context.workspaceId ||
      durable.grantedByUserId !== context.actorUserId
    ) {
      return invalid();
    }
    const verified = requireRecord(durable);
    if (verified.status !== 'revoked' || verified.revokedAt === null) {
      return invalid();
    }
    return verified;
  }
}
