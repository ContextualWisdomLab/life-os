import { describe, expect, it } from 'vitest';
import {
  getPluginContractDiscovery,
  MAXIMUM_PLUGIN_EVENT_BYTES,
  PluginContractError,
  preparePluginEvent,
  serializeCanonicalJson,
  signPluginDelivery,
  validatePluginManifest,
  verifyPluginDelivery,
} from './index';

const WORKSPACE_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const EVENT_ID = '59b7f370-b733-435d-a72a-40878d6cffd1';
const SUBJECT_ID = '474c83ae-08af-4a63-957b-49eb2093a61d';
const DELIVERY_ID = 'e021b411-f75e-4490-97a4-f1f6ee811849';
const TEST_SIGNING_MATERIAL = new TextEncoder().encode(
  ['unit', 'plugin', 'signature', 'material', 'only'].join(':'),
);
const TEST_EMBEDDED_VALUE = ['must', 'not', 'be', 'embedded'].join(':');

function eventRequest(data: unknown = { title: 'Prepare launch', version: 2 }) {
  return {
    eventId: EVENT_ID,
    eventType: 'lifeos.planning.task-changed.v1',
    occurredAt: '2026-08-04T00:00:00.000Z',
    subject: `urn:life-os:task:${SUBJECT_ID}`,
    dataSchema: 'https://schemas.life-os.org/events/planning/task-changed/v1',
    data,
  };
}

describe('plugin SDK contract', () => {
  it('validates a strict credential-free manifest', () => {
    expect(
      validatePluginManifest({
        pluginId: 'com.example.lifeos.connector',
        displayName: 'Example Connector',
        contractVersion: '1.0',
        subscriptions: [
          'lifeos.planning.task-changed.v1',
          'lifeos.habit.check-in-recorded.v1',
        ],
      }),
    ).toEqual({
      pluginId: 'com.example.lifeos.connector',
      displayName: 'Example Connector',
      contractVersion: '1.0',
      subscriptions: [
        'lifeos.planning.task-changed.v1',
        'lifeos.habit.check-in-recorded.v1',
      ],
    });

    expect(() =>
      validatePluginManifest({
        pluginId: 'com.example.lifeos.connector',
        displayName: 'Example Connector',
        contractVersion: '1.0',
        subscriptions: ['lifeos.planning.task-changed.v1'],
        secret: TEST_EMBEDDED_VALUE,
      }),
    ).toThrow(PluginContractError);
    expect(() =>
      validatePluginManifest({
        pluginId: 'com.example.lifeos.connector',
        displayName: 'Example Connector',
        contractVersion: '1.0',
        subscriptions: [
          'lifeos.planning.task-changed.v1',
          'lifeos.planning.task-changed.v1',
        ],
      }),
    ).toThrow(PluginContractError);
  });

  it('creates deterministic tenant-scoped CloudEvents without payload ownership injection', () => {
    const prepared = preparePluginEvent(
      WORKSPACE_ID,
      eventRequest({
        version: 2,
        title: 'Prepare launch',
      }),
    );
    expect(prepared.event).toMatchObject({
      specversion: '1.0',
      id: EVENT_ID,
      source: `urn:life-os:workspace:${WORKSPACE_ID}`,
      type: 'lifeos.planning.task-changed.v1',
      subject: `urn:life-os:task:${SUBJECT_ID}`,
      datacontenttype: 'application/json',
    });
    expect(prepared.serializedEvent).toBe(
      serializeCanonicalJson(prepared.event),
    );
    expect(prepared.serializedEvent.indexOf('"title"')).toBeLessThan(
      prepared.serializedEvent.indexOf('"version"'),
    );
    expect(prepared.byteLength).toBeLessThan(MAXIMUM_PLUGIN_EVENT_BYTES);

    expect(() =>
      preparePluginEvent(WORKSPACE_ID, {
        ...eventRequest(),
        workspaceId: '474c83ae-08af-4a63-957b-49eb2093a61d',
      }),
    ).toThrow(PluginContractError);
  });

  it('signs exact bytes and rejects tampering, replays outside the window, and weak secrets', () => {
    const serialized = preparePluginEvent(WORKSPACE_ID, eventRequest())
      .serializedEvent;
    const timestamp = 1_775_433_600;
    const proof = signPluginDelivery(
      serialized,
      DELIVERY_ID,
      timestamp,
      TEST_SIGNING_MATERIAL,
    );
    expect(
      verifyPluginDelivery(
        serialized,
        proof,
        TEST_SIGNING_MATERIAL,
        timestamp * 1_000,
      ),
    ).toBe(true);
    expect(
      verifyPluginDelivery(
        `${serialized} `,
        proof,
        TEST_SIGNING_MATERIAL,
        timestamp * 1_000,
      ),
    ).toBe(false);
    expect(
      verifyPluginDelivery(
        serialized,
        proof,
        TEST_SIGNING_MATERIAL,
        (timestamp + 301) * 1_000,
      ),
    ).toBe(false);
    expect(() =>
      signPluginDelivery(
        serialized,
        DELIVERY_ID,
        timestamp,
        new Uint8Array(16),
      ),
    ).toThrow(PluginContractError);
  });

  it('fails closed on oversized, non-JSON, or prototype-sensitive data', () => {
    expect(() =>
      preparePluginEvent(
        WORKSPACE_ID,
        eventRequest({ payload: 'x'.repeat(MAXIMUM_PLUGIN_EVENT_BYTES) }),
      ),
    ).toThrow(PluginContractError);
    expect(() =>
      preparePluginEvent(WORKSPACE_ID, eventRequest({ value: Number.NaN })),
    ).toThrow(PluginContractError);
    expect(() =>
      preparePluginEvent(
        WORKSPACE_ID,
        eventRequest(JSON.parse('{"__proto__":{"polluted":true}}')),
      ),
    ).toThrow(PluginContractError);
  });

  it('publishes an explicit non-delivery capability boundary', () => {
    expect(getPluginContractDiscovery()).toEqual({
      contractVersion: '1.0',
      cloudEventsSpecVersion: '1.0',
      eventContentType: 'application/cloudevents+json',
      maximumEventBytes: 65_536,
      signatureAlgorithm: 'hmac-sha256',
      deliveryTimestampSkewSeconds: 300,
      capabilities: ['manifest-validation', 'event-preparation'],
      deferredCapabilities: [
        'plugin-installation',
        'secret-storage',
        'outbound-delivery',
        'inbound-commands',
      ],
    });
  });
});
