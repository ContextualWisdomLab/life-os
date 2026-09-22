import { expect, it } from 'vitest';
import {
  preparePluginEvent,
  signPluginDelivery,
  verifyPluginDelivery,
} from './index';

const WORKSPACE_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const EVENT_ID = '59b7f370-b733-435d-a72a-40878d6cffd1';
const SUBJECT_ID = '474c83ae-08af-4a63-957b-49eb2093a61d';
const DELIVERY_ID = 'e021b411-f75e-4490-97a4-f1f6ee811849';
const TEST_SIGNING_MATERIAL = new TextEncoder().encode(
  ['unit', 'plugin', 'signature', 'material', 'only'].join(':'),
);
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function signedDelivery() {
  const serializedEvent = preparePluginEvent(WORKSPACE_ID, {
    eventId: EVENT_ID,
    eventType: 'lifeos.planning.task-changed.v1',
    occurredAt: '2026-08-04T00:00:00.000Z',
    subject: `urn:life-os:task:${SUBJECT_ID}`,
    dataSchema: 'https://schemas.life-os.org/events/planning/task-changed/v1',
    data: { title: 'Prepare launch', version: 2 },
  }).serializedEvent;
  const timestamp = 1_775_433_600;
  const proof = signPluginDelivery(
    serializedEvent,
    DELIVERY_ID,
    timestamp,
    TEST_SIGNING_MATERIAL,
  );
  return { serializedEvent, timestamp, proof };
}

it('rejects every noncanonical base64url spelling of an otherwise valid plugin delivery HMAC', () => {
  const { serializedEvent, timestamp, proof } = signedDelivery();

  const finalIndex = BASE64URL_ALPHABET.indexOf(
    proof.signature[proof.signature.length - 1]!,
  );
  expect(finalIndex).toBeGreaterThanOrEqual(0);
  // A 32-byte HMAC leaves four data bits for the final unpadded base64url
  // sextet. Canonical encoding therefore requires its low two pad bits to be
  // zero; the other three low-bit spellings decode to the same 32 bytes.
  expect(finalIndex % 4).toBe(0);

  for (let aliasOffset = 1; aliasOffset < 4; aliasOffset += 1) {
    const alternateFinalCharacter =
      BASE64URL_ALPHABET[finalIndex + aliasOffset]!;
    const noncanonicalSignature = `${proof.signature.slice(
      0,
      -1,
    )}${alternateFinalCharacter}`;

    expect(noncanonicalSignature).not.toBe(proof.signature);
    expect(Buffer.from(noncanonicalSignature, 'base64url')).toEqual(
      Buffer.from(proof.signature, 'base64url'),
    );
    expect(
      verifyPluginDelivery(
        serializedEvent,
        { ...proof, signature: noncanonicalSignature },
        TEST_SIGNING_MATERIAL,
        timestamp * 1_000,
      ),
    ).toBe(false);
  }
});

it('rejects a byte-different casing alias of the signed delivery identifier', () => {
  const { serializedEvent, timestamp, proof } = signedDelivery();
  const noncanonicalDeliveryId = proof.deliveryId.toUpperCase();

  expect(noncanonicalDeliveryId).not.toBe(proof.deliveryId);
  expect(
    verifyPluginDelivery(
      serializedEvent,
      { ...proof, deliveryId: noncanonicalDeliveryId },
      TEST_SIGNING_MATERIAL,
      timestamp * 1_000,
    ),
  ).toBe(false);
});
