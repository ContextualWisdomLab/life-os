import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROPOSAL_EVALUATION_FIXTURES,
  PROPOSAL_EVALUATION_SUITE_VERSION,
} from './proposal-quality-fixtures';

describe('default proposal quality fixtures', () => {
  it('cover realistic multilingual, temporal, empty, completed, and injection scenarios', () => {
    expect(PROPOSAL_EVALUATION_SUITE_VERSION).toBe('2026-08-05.1');
    expect(DEFAULT_PROPOSAL_EVALUATION_FIXTURES).toHaveLength(7);
    expect(
      DEFAULT_PROPOSAL_EVALUATION_FIXTURES.map((fixture) => fixture.id),
    ).toEqual([
      'active_launch_task',
      'completed_then_active_project',
      'empty_context_next_task',
      'korean_active_task',
      'dated_milestone_objective',
      'direct_prompt_injection',
      'indirect_prompt_injection',
    ]);

    const text = JSON.stringify(DEFAULT_PROPOSAL_EVALUATION_FIXTURES);
    expect(text).toContain('오늘');
    expect(text).toContain('2026-08-12');
    expect(text).toContain('DIRECT_INJECTION_SENTINEL');
    expect(text).toContain('INDIRECT_INJECTION_SENTINEL');
    expect(
      DEFAULT_PROPOSAL_EVALUATION_FIXTURES.some(
        (fixture) => fixture.request.context.length === 0,
      ),
    ).toBe(true);
    expect(
      DEFAULT_PROPOSAL_EVALUATION_FIXTURES.some((fixture) =>
        fixture.request.context.some((item) => item.status === 'completed'),
      ),
    ).toBe(true);
    expect(
      DEFAULT_PROPOSAL_EVALUATION_FIXTURES.filter(
        (fixture) => fixture.category === 'prompt_injection',
      ),
    ).toHaveLength(2);
  });

  it('remain deeply frozen and require only inert operation kinds', () => {
    expect(Object.isFrozen(DEFAULT_PROPOSAL_EVALUATION_FIXTURES)).toBe(true);
    for (const fixture of DEFAULT_PROPOSAL_EVALUATION_FIXTURES) {
      expect(Object.isFrozen(fixture)).toBe(true);
      expect(Object.isFrozen(fixture.request)).toBe(true);
      expect(Object.isFrozen(fixture.request.context)).toBe(true);
      expect(Object.isFrozen(fixture.allowedOperationKinds)).toBe(true);
      expect(Object.isFrozen(fixture.requiredTargetIds)).toBe(true);
      expect(Object.isFrozen(fixture.forbiddenTextFragments)).toBe(true);
      expect(fixture.allowedOperationKinds).not.toContain('execute_command');
      expect(fixture.allowedOperationKinds).not.toContain('apply_proposal');
    }
  });

  it('binds every required target to supplied context evidence', () => {
    for (const fixture of DEFAULT_PROPOSAL_EVALUATION_FIXTURES) {
      const contextIds = new Set(fixture.request.context.map((item) => item.id));
      for (const targetId of fixture.requiredTargetIds) {
        expect(contextIds.has(targetId)).toBe(true);
      }
    }
  });
});
