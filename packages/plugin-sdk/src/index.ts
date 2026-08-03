import { createHmac, timingSafeEqual } from 'node:crypto';

/** Current LifeOS plugin contract version. */
export const PLUGIN_CONTRACT_VERSION = '1.0' as const;
/** CloudEvents core specification version used by the plugin contract. */
export const CLOUD_EVENTS_SPEC_VERSION = '1.0' as const;
/** Maximum canonical structured-event size accepted by the contract. */
export const MAXIMUM_PLUGIN_EVENT_BYTES = 64 * 1_024;
/** Maximum accepted delivery timestamp skew in seconds. */
export const DEFAULT_DELIVERY_SKEW_SECONDS = 300;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLUGIN_IDENTIFIER_PATTERN =
  /^(?:[a-z][a-z0-9-]{0,30}\.){2,7}[a-z][a-z0-9-]{0,30}$/;
const EVENT_TYPE_PATTERN =
  /^lifeos\.[a-z][a-z0-9-]{1,30}\.[a-z][a-z0-9-]{1,30}\.v1$/;
const SUBJECT_PATTERN =
  /^urn:life-os:[a-z][a-z0-9-]{1,30}:[0-9a-f-]{36}$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FORBIDDEN_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Bounded contract-validation failure without untrusted value reflection. */
export class PluginContractError extends Error {
  constructor() {
    super('Plugin contract is invalid');
    this.name = 'PluginContractError';
  }
}

/** Versioned third-party plugin declaration. */
export interface PluginManifest {
  readonly pluginId: string;
  readonly displayName: string;
  readonly contractVersion: typeof PLUGIN_CONTRACT_VERSION;
  readonly subscriptions: readonly string[];
}

/** Untrusted input used to construct a tenant-scoped CloudEvent. */
export interface PluginEventRequest {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly subject: string;
  readonly dataSchema: string;
  readonly data: unknown;
}

/** LifeOS structured JSON CloudEvent exposed to plugins. */
export interface PluginCloudEvent {
  readonly specversion: typeof CLOUD_EVENTS_SPEC_VERSION;
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly time: string;
  readonly subject: string;
  readonly datacontenttype: 'application/json';
  readonly dataschema: string;
  readonly data: unknown;
}

/** Canonical event and exact serialized bytes used for delivery signatures. */
export interface PreparedPluginEvent {
  readonly event: PluginCloudEvent;
  readonly serializedEvent: string;
  readonly byteLength: number;
}

/** HMAC delivery proof for one exact event body. */
export interface PluginDeliverySignature {
  readonly algorithm: 'hmac-sha256';
  readonly deliveryId: string;
  readonly timestamp: number;
  readonly signature: string;
}

/** Public discovery document for the initial non-delivery plugin surface. */
export interface PluginContractDiscovery {
  readonly contractVersion: typeof PLUGIN_CONTRACT_VERSION;
  readonly cloudEventsSpecVersion: typeof CLOUD_EVENTS_SPEC_VERSION;
  readonly eventContentType: 'application/cloudevents+json';
  readonly maximumEventBytes: number;
  readonly signatureAlgorithm: 'hmac-sha256';
  readonly deliveryTimestampSkewSeconds: number;
  readonly capabilities: readonly ['manifest-validation', 'event-preparation'];
  readonly deferredCapabilities: readonly [
    'plugin-installation',
    'secret-storage',
    'outbound-delivery',
    'inbound-commands',
  ];
}

function invalid(): never {
  throw new PluginContractError();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): void {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key, index) => key !== expected[index])
  ) {
    invalid();
  }
}

function requireString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  if (
    value.length < minimumLength ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\u0000\r\n]/.test(value)
  ) {
    return invalid();
  }
  return value;
}

function requireUuidV4(value: unknown): string {
  const normalized = requireString(value, 36, 36).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireRfc3339Instant(value: unknown): string {
  const normalized = requireString(value, 20, 35);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(normalized)) {
    return invalid();
  }
  const timestamp = new Date(normalized);
  if (!Number.isFinite(timestamp.getTime())) {
    return invalid();
  }
  return normalized;
}

function canonicalizeJsonValue(value: unknown, depth: number): unknown {
  if (depth > 20) {
    return invalid();
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return invalid();
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) {
      return invalid();
    }
    return value.map((entry) => canonicalizeJsonValue(entry, depth + 1));
  }
  if (!isPlainRecord(value)) {
    return invalid();
  }
  const keys = Object.keys(value).sort();
  if (keys.length > 100) {
    return invalid();
  }
  const canonical: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (
      key.length < 1 ||
      key.length > 100 ||
      FORBIDDEN_PROPERTY_NAMES.has(key) ||
      /[\u0000\r\n]/.test(key)
    ) {
      return invalid();
    }
    canonical[key] = canonicalizeJsonValue(value[key], depth + 1);
  }
  return canonical;
}

/** Serializes JSON deterministically by recursively sorting object keys. */
export function serializeCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value, 0));
}

/** Validates and freezes a strict credential-free plugin manifest. */
export function validatePluginManifest(input: unknown): PluginManifest {
  if (!isPlainRecord(input)) {
    return invalid();
  }
  requireExactKeys(input, [
    'pluginId',
    'displayName',
    'contractVersion',
    'subscriptions',
  ]);
  const pluginId = requireString(input.pluginId, 5, 255).toLowerCase();
  if (!PLUGIN_IDENTIFIER_PATTERN.test(pluginId)) {
    return invalid();
  }
  const displayName = requireString(input.displayName, 1, 100);
  if (input.contractVersion !== PLUGIN_CONTRACT_VERSION) {
    return invalid();
  }
  if (!Array.isArray(input.subscriptions)) {
    return invalid();
  }
  if (input.subscriptions.length < 1 || input.subscriptions.length > 32) {
    return invalid();
  }
  const subscriptions = input.subscriptions.map((entry) => {
    const eventType = requireString(entry, 10, 100);
    if (!EVENT_TYPE_PATTERN.test(eventType)) {
      return invalid();
    }
    return eventType;
  });
  if (new Set(subscriptions).size !== subscriptions.length) {
    return invalid();
  }
  return Object.freeze({
    pluginId,
    displayName,
    contractVersion: PLUGIN_CONTRACT_VERSION,
    subscriptions: Object.freeze([...subscriptions]),
  });
}

function requireDataSchema(value: unknown): string {
  const schema = requireString(value, 20, 300);
  let url: URL;
  try {
    url = new URL(schema);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'schemas.life-os.org' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !url.pathname.startsWith('/events/')
  ) {
    return invalid();
  }
  return url.toString();
}

/** Creates a strict tenant-scoped CloudEvents 1.0 structured JSON event. */
export function preparePluginEvent(
  workspaceIdInput: unknown,
  input: unknown,
): PreparedPluginEvent {
  const workspaceId = requireUuidV4(workspaceIdInput);
  if (!isPlainRecord(input)) {
    return invalid();
  }
  requireExactKeys(input, [
    'eventId',
    'eventType',
    'occurredAt',
    'subject',
    'dataSchema',
    'data',
  ]);
  const eventId = requireUuidV4(input.eventId);
  const eventType = requireString(input.eventType, 10, 100);
  if (!EVENT_TYPE_PATTERN.test(eventType)) {
    return invalid();
  }
  const subject = requireString(input.subject, 50, 100);
  if (!SUBJECT_PATTERN.test(subject)) {
    return invalid();
  }
  const subjectIdentifier = subject.slice(subject.lastIndexOf(':') + 1);
  requireUuidV4(subjectIdentifier);
  const occurredAt = requireRfc3339Instant(input.occurredAt);
  const dataSchema = requireDataSchema(input.dataSchema);
  const canonicalData = canonicalizeJsonValue(input.data, 0);
  const event: PluginCloudEvent = Object.freeze({
    specversion: CLOUD_EVENTS_SPEC_VERSION,
    id: eventId,
    source: `urn:life-os:workspace:${workspaceId}`,
    type: eventType,
    time: occurredAt,
    subject: subject.toLowerCase(),
    datacontenttype: 'application/json',
    dataschema: dataSchema,
    data: canonicalData,
  });
  const serializedEvent = serializeCanonicalJson(event);
  const byteLength = Buffer.byteLength(serializedEvent, 'utf8');
  if (byteLength > MAXIMUM_PLUGIN_EVENT_BYTES) {
    return invalid();
  }
  return Object.freeze({ event, serializedEvent, byteLength });
}

function requireSecret(secret: Uint8Array): Buffer {
  if (!(secret instanceof Uint8Array) || secret.byteLength < 32 || secret.byteLength > 256) {
    return invalid();
  }
  return Buffer.from(secret);
}

function requireTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return invalid();
  }
  return Number(value);
}

function signatureBase(
  serializedEvent: string,
  deliveryId: string,
  timestamp: number,
): string {
  if (Buffer.byteLength(serializedEvent, 'utf8') > MAXIMUM_PLUGIN_EVENT_BYTES) {
    return invalid();
  }
  return `life-os-v1\n${timestamp}\n${deliveryId}\n${serializedEvent}`;
}

/** Signs the exact canonical event bytes and replay identifiers with HMAC-SHA256. */
export function signPluginDelivery(
  serializedEvent: string,
  deliveryIdInput: unknown,
  timestampInput: unknown,
  secret: Uint8Array,
): PluginDeliverySignature {
  const deliveryId = requireUuidV4(deliveryIdInput);
  const timestamp = requireTimestamp(timestampInput);
  const signature = createHmac('sha256', requireSecret(secret))
    .update(signatureBase(serializedEvent, deliveryId, timestamp), 'utf8')
    .digest('base64url');
  return Object.freeze({
    algorithm: 'hmac-sha256',
    deliveryId,
    timestamp,
    signature,
  });
}

/** Verifies an exact delivery signature and rejects stale or future timestamps. */
export function verifyPluginDelivery(
  serializedEvent: string,
  proofInput: unknown,
  secret: Uint8Array,
  nowMilliseconds: number = Date.now(),
  maximumSkewSeconds: number = DEFAULT_DELIVERY_SKEW_SECONDS,
): boolean {
  if (!isPlainRecord(proofInput)) {
    return false;
  }
  try {
    requireExactKeys(proofInput, [
      'algorithm',
      'deliveryId',
      'timestamp',
      'signature',
    ]);
    if (proofInput.algorithm !== 'hmac-sha256') {
      return false;
    }
    const deliveryId = requireUuidV4(proofInput.deliveryId);
    const timestamp = requireTimestamp(proofInput.timestamp);
    const signature = requireString(proofInput.signature, 43, 43);
    if (!SIGNATURE_PATTERN.test(signature)) {
      return false;
    }
    if (
      !Number.isFinite(nowMilliseconds) ||
      !Number.isInteger(maximumSkewSeconds) ||
      maximumSkewSeconds < 1 ||
      maximumSkewSeconds > 3_600 ||
      Math.abs(Math.floor(nowMilliseconds / 1_000) - timestamp) >
        maximumSkewSeconds
    ) {
      return false;
    }
    const expected = createHmac('sha256', requireSecret(secret))
      .update(signatureBase(serializedEvent, deliveryId, timestamp), 'utf8')
      .digest();
    const supplied = Buffer.from(signature, 'base64url');
    return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

/** Returns the immutable public contract discovery document. */
export function getPluginContractDiscovery(): PluginContractDiscovery {
  return Object.freeze({
    contractVersion: PLUGIN_CONTRACT_VERSION,
    cloudEventsSpecVersion: CLOUD_EVENTS_SPEC_VERSION,
    eventContentType: 'application/cloudevents+json',
    maximumEventBytes: MAXIMUM_PLUGIN_EVENT_BYTES,
    signatureAlgorithm: 'hmac-sha256',
    deliveryTimestampSkewSeconds: DEFAULT_DELIVERY_SKEW_SECONDS,
    capabilities: Object.freeze([
      'manifest-validation',
      'event-preparation',
    ] as const),
    deferredCapabilities: Object.freeze([
      'plugin-installation',
      'secret-storage',
      'outbound-delivery',
      'inbound-commands',
    ] as const),
  });
}
