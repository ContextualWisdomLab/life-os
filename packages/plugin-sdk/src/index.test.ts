import { describe, expect, it } from 'vitest';
import {
  PluginContractError,
  validatePluginManifest,
} from './index';

function validManifest(): Record<string, unknown> {
  return {
    schema: 'life-os.plugin-manifest.v1',
    plugin_id: 'acme.delivery-assistant',
    version: '1.2.3',
    display_name: 'Acme Delivery Assistant',
    callback_url: 'https://hooks.example.com/life-os',
    permissions: ['planning.read', 'planning.write'],
    webhook_event_types: [
      'planning.task.created',
      'planning.task.completed',
    ],
  };
}

describe('validatePluginManifest', () => {
  it('normalizes and freezes a bounded versioned manifest', () => {
    const manifest = validatePluginManifest(validManifest());

    expect(manifest).toEqual({
      schema: 'life-os.plugin-manifest.v1',
      plugin_id: 'acme.delivery-assistant',
      version: '1.2.3',
      display_name: 'Acme Delivery Assistant',
      callback_url: 'https://hooks.example.com/life-os',
      permissions: ['planning.read', 'planning.write'],
      webhook_event_types: [
        'planning.task.completed',
        'planning.task.created',
      ],
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.permissions)).toBe(true);
  });

  it.each([
    ['unsupported schema', { schema: 'life-os.plugin-manifest.v2' }],
    ['numeric identifier', { plugin_id: '12345' }],
    ['unversioned identifier', { plugin_id: 'acme' }],
    ['non-semantic version', { version: 'latest' }],
    ['unknown permission', { permissions: ['database.direct'] }],
    [
      'duplicate event',
      {
        webhook_event_types: [
          'planning.task.created',
          'planning.task.created',
        ],
      },
    ],
    ['unknown field', { secret: 'should-not-be-accepted' }],
  ])('rejects %s without echoing untrusted values', (_label, override) => {
    const input = { ...validManifest(), ...override };

    expect(() => validatePluginManifest(input)).toThrow(PluginContractError);
    try {
      validatePluginManifest(input);
    } catch (error) {
      expect(String(error)).not.toContain('database.direct');
      expect(String(error)).not.toContain('should-not-be-accepted');
    }
  });

  it.each([
    'http://hooks.example.com/life-os',
    'https://localhost/life-os',
    'https://127.0.0.1/life-os',
    'https://10.0.0.4/life-os',
    'https://169.254.169.254/latest/meta-data',
    'https://service.internal/life-os',
    'https://user:password@hooks.example.com/life-os',
    'https://hooks.example.com/life-os?token=secret',
  ])('rejects non-public or credential-bearing callback URL %s', (url) => {
    expect(() =>
      validatePluginManifest({ ...validManifest(), callback_url: url }),
    ).toThrow(PluginContractError);
  });
});
