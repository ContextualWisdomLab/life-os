import { isIP } from 'node:net';

/** Stable schema identifier for LifeOS plugin manifests. */
export const PLUGIN_MANIFEST_SCHEMA = 'life-os.plugin-manifest.v1' as const;

/** Capabilities that a third-party plugin may request from the public boundary. */
export const PLUGIN_PERMISSIONS = [
  'calendar.write',
  'habit.read',
  'notification.write',
  'planning.read',
  'planning.write',
  'review.write',
] as const;

/** Events that the integration service may deliver to a registered plugin. */
export const PLUGIN_WEBHOOK_EVENT_TYPES = [
  'habit.completed',
  'planning.task.completed',
  'planning.task.created',
  'review.completed',
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];
export type PluginWebhookEventType =
  (typeof PLUGIN_WEBHOOK_EVENT_TYPES)[number];

/** Versioned, bounded contract accepted by the LifeOS integration surface. */
export interface PluginManifest {
  readonly schema: typeof PLUGIN_MANIFEST_SCHEMA;
  readonly plugin_id: string;
  readonly version: string;
  readonly display_name: string;
  readonly callback_url: string;
  readonly permissions: readonly PluginPermission[];
  readonly webhook_event_types: readonly PluginWebhookEventType[];
}

/** Stable validation error returned without echoing untrusted manifest data. */
export class PluginContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PluginContractError';
  }
}

const MANIFEST_KEYS = new Set([
  'callback_url',
  'display_name',
  'permissions',
  'plugin_id',
  'schema',
  'version',
  'webhook_event_types',
]);
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)+$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function requireRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new PluginContractError('plugin_manifest_invalid');
  }
  return input as Record<string, unknown>;
}

function requireBoundedString(
  value: unknown,
  code: string,
  maximumLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new PluginContractError(code);
  }
  return value;
}

function requireUniqueEnumValues<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  code: string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new PluginContractError(code);
  }
  const allowed = new Set<string>(allowedValues);
  const observed = new Set<string>();
  const normalized: T[] = [];
  for (const entry of value) {
    if (
      typeof entry !== 'string' ||
      !allowed.has(entry) ||
      observed.has(entry)
    ) {
      throw new PluginContractError(code);
    }
    observed.add(entry);
    normalized.push(entry as T);
  }
  return Object.freeze(normalized.sort());
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function requirePublicHttpsUrl(value: unknown): string {
  const candidate = requireBoundedString(
    value,
    'plugin_callback_url_invalid',
    2_048,
  );
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new PluginContractError('plugin_callback_url_invalid');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.port.length > 0 ||
    parsed.pathname === '/' ||
    parsed.search.length > 0
  ) {
    throw new PluginContractError('plugin_callback_url_invalid');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.startsWith('[')
  ) {
    throw new PluginContractError('plugin_callback_url_not_public');
  }
  const ipVersion = isIP(hostname);
  if (
    (ipVersion === 4 && isPrivateIpv4(hostname)) ||
    (ipVersion === 0 && !hostname.includes('.'))
  ) {
    throw new PluginContractError('plugin_callback_url_not_public');
  }
  return parsed.toString();
}

/** Validates and freezes an untrusted plugin manifest at the public boundary. */
export function validatePluginManifest(input: unknown): PluginManifest {
  const record = requireRecord(input);
  if (
    Object.keys(record).length !== MANIFEST_KEYS.size ||
    Object.keys(record).some((key) => !MANIFEST_KEYS.has(key))
  ) {
    throw new PluginContractError('plugin_manifest_fields_invalid');
  }
  if (record.schema !== PLUGIN_MANIFEST_SCHEMA) {
    throw new PluginContractError('plugin_manifest_schema_unsupported');
  }

  const pluginId = requireBoundedString(
    record.plugin_id,
    'plugin_id_invalid',
    120,
  );
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new PluginContractError('plugin_id_invalid');
  }
  const version = requireBoundedString(
    record.version,
    'plugin_version_invalid',
    32,
  );
  if (!SEMVER_PATTERN.test(version)) {
    throw new PluginContractError('plugin_version_invalid');
  }

  return Object.freeze({
    schema: PLUGIN_MANIFEST_SCHEMA,
    plugin_id: pluginId,
    version,
    display_name: requireBoundedString(
      record.display_name,
      'plugin_display_name_invalid',
      80,
    ),
    callback_url: requirePublicHttpsUrl(record.callback_url),
    permissions: requireUniqueEnumValues(
      record.permissions,
      PLUGIN_PERMISSIONS,
      'plugin_permissions_invalid',
    ),
    webhook_event_types: requireUniqueEnumValues(
      record.webhook_event_types,
      PLUGIN_WEBHOOK_EVENT_TYPES,
      'plugin_webhook_events_invalid',
    ),
  });
}
