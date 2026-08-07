import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PrivacyAccessApplicationError } from './privacy-access-application';
import {
  PrivacyHttpValidationError,
  deniedPrivacyDecisionException,
  extractPrivacyServiceContextHeaders,
  parsePrivacyAccessConsumeBody,
  parsePrivacyAccessDecisionBody,
  toPrivacyHttpException,
} from './privacy-http-boundary';
import { PrivacyServiceContextError } from './privacy-service-context';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const SIGNATURE = Buffer.alloc(32, 0x44).toString('base64url');

describe('privacy access decision HTTP body', () => {
  it('accepts one exact bounded ordinary request', () => {
    expect(
      parsePrivacyAccessDecisionBody({
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 600,
      }),
    ).toEqual({
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });
  });

  it('accepts one privileged request with a bounded Unicode reason', () => {
    expect(
      parsePrivacyAccessDecisionBody({
        purpose: 'account_support',
        action: 'read',
        resourceCategory: 'identity_profile',
        requestedTtlSeconds: 300,
        reason: '지원 사례 SUP-8841에 대한 정확한 프로필 확인이 필요합니다.',
      }),
    ).toMatchObject({ purpose: 'account_support', reason: expect.any(String) });
  });

  it.each([
    null,
    [],
    {},
    {
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
      workspaceId: WORKSPACE_ID,
    },
    {
      purpose: ['workspace_operation'],
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    },
    {
      purpose: 'unknown',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    },
    {
      purpose: 'workspace_operation',
      action: 'delete',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    },
    {
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'all_data',
      requestedTtlSeconds: 600,
    },
    {
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 1.5,
    },
    {
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 901,
    },
    {
      purpose: 'account_support',
      action: 'read',
      resourceCategory: 'identity_profile',
      requestedTtlSeconds: 300,
      reason: 'line\nbreak',
    },
    {
      purpose: 'account_support',
      action: 'read',
      resourceCategory: 'identity_profile',
      requestedTtlSeconds: 300,
      reason: '한'.repeat(700),
    },
  ])('rejects unsafe decision body %#', (body) => {
    expect(() => parsePrivacyAccessDecisionBody(body)).toThrow(
      PrivacyHttpValidationError,
    );
  });
});

describe('privacy access consumption HTTP body', () => {
  it('accepts exact token and optional resource reference', () => {
    expect(
      parsePrivacyAccessConsumeBody({
        grantToken: `${'a'.repeat(64)}.${'b'.repeat(43)}`,
        resourceReference: '프로필-primary',
      }),
    ).toEqual({
      grantToken: `${'a'.repeat(64)}.${'b'.repeat(43)}`,
      resourceReference: '프로필-primary',
    });
  });

  it.each([
    null,
    {},
    { grantToken: ['repeated'] },
    { grantToken: 'invalid' },
    { grantToken: `${'a'.repeat(16_385)}.b` },
    { grantToken: 'a.b', workspaceId: WORKSPACE_ID },
    { grantToken: 'a.b', resourceReference: 'line\nbreak' },
    { grantToken: 'a.b', resourceReference: 'x'.repeat(257) },
    { grantToken: 'a.b', resourceReference: '한'.repeat(400) },
  ])('rejects unsafe consume body %#', (body) => {
    expect(() => parsePrivacyAccessConsumeBody(body)).toThrow(
      PrivacyHttpValidationError,
    );
  });
});

describe('privacy service context header extraction', () => {
  it('selects only the private context headers from normal HTTP metadata', () => {
    expect(
      extractPrivacyServiceContextHeaders({
        host: 'privacy-service:4108',
        connection: 'keep-alive',
        'x-life-os-context-key-id': 'privacy-context-active',
        'x-life-os-workspace-id': WORKSPACE_ID,
        'x-life-os-actor-id': ACTOR_ID,
        'x-life-os-context-issued-at': '1786078800',
        'x-life-os-context-signature': SIGNATURE,
      }),
    ).toEqual({
      'x-life-os-context-key-id': 'privacy-context-active',
      'x-life-os-workspace-id': WORKSPACE_ID,
      'x-life-os-actor-id': ACTOR_ID,
      'x-life-os-context-issued-at': '1786078800',
      'x-life-os-context-signature': SIGNATURE,
    });
  });

  it.each([
    {},
    {
      'x-life-os-context-key-id': ['repeated'],
      'x-life-os-workspace-id': WORKSPACE_ID,
      'x-life-os-actor-id': ACTOR_ID,
      'x-life-os-context-issued-at': '1786078800',
      'x-life-os-context-signature': SIGNATURE,
    },
    {
      'x-life-os-context-key-id': 'privacy-context-active',
      'x-life-os-workspace-id': WORKSPACE_ID,
      'x-life-os-actor-id': ACTOR_ID,
      'x-life-os-context-issued-at': '1786078800',
    },
  ])('rejects missing or repeated context headers %#', (headers) => {
    expect(() => extractPrivacyServiceContextHeaders(headers)).toThrow(
      PrivacyHttpValidationError,
    );
  });
});

describe('privacy RFC 9457 problem mapping', () => {
  it('maps validation and context failures without exposing rejected input', () => {
    const validation = toPrivacyHttpException(new PrivacyHttpValidationError());
    expect(validation.getStatus()).toBe(400);
    expect(validation.getResponse()).toEqual({
      type: 'about:blank',
      title: 'Privacy access request is invalid',
      status: 400,
      code: 'invalid_request',
    });

    const context = toPrivacyHttpException(new PrivacyServiceContextError());
    expect(context.getStatus()).toBe(401);
    expect(context.getResponse()).toEqual({
      type: 'about:blank',
      title: 'Authentication is required',
      status: 401,
      code: 'authentication_required',
    });
  });

  it('maps application and unknown failures to a credential-free unavailable problem', () => {
    for (const error of [
      new PrivacyAccessApplicationError(),
      new Error('database password private'),
      'private failure',
    ]) {
      const result = toPrivacyHttpException(error);
      expect(result.getStatus()).toBe(503);
      expect(result.getResponse()).toEqual({
        type: 'about:blank',
        title: 'Privacy access service is unavailable',
        status: 503,
        code: 'privacy_service_unavailable',
      });
      expect(JSON.stringify(result.getResponse())).not.toContain('private');
    }
  });

  it('preserves an existing bounded HttpException', () => {
    const original = new HttpException({ safe: true }, 429);
    expect(toPrivacyHttpException(original)).toBe(original);
  });

  it('creates a denied problem carrying only an opaque decision receipt', () => {
    const denied = deniedPrivacyDecisionException(DECISION_ID);
    expect(denied.getStatus()).toBe(403);
    expect(denied.getResponse()).toEqual({
      type: 'about:blank',
      title: 'Privacy access is not permitted',
      status: 403,
      code: 'access_denied',
      decisionId: DECISION_ID,
    });
    expect(() => deniedPrivacyDecisionException('numeric-1')).toThrow(
      PrivacyHttpValidationError,
    );
  });
});
