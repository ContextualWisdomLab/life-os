import { describe, expect, it } from 'vitest';
import { parseTodayWritePrecondition } from './today-http';
import {
  TodayRevisionConflictError,
  TodaySyncService,
  type DurableTodayAggregate,
  type TodayRepository,
  type TodayWriteCommand,
  type TodayWriteResult,
} from './today-sync';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REVISION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IDEMPOTENCY_KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DATE = '2026-08-09';

const AGGREGATE: DurableTodayAggregate = Object.freeze({
  version: 'life-os.today.v1',
  aggregateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  revision: REVISION,
  date: DATE,
  actions: Object.freeze([]),
});

const DRAFT = Object.freeze({
  version: 'life-os.today.v1' as const,
  date: DATE,
  actions: Object.freeze([]),
});

class ExactRevisionRepository implements TodayRepository {
  async getToday(): Promise<DurableTodayAggregate> {
    return AGGREGATE;
  }

  async writeToday(command: TodayWriteCommand): Promise<TodayWriteResult> {
    if (
      command.precondition.kind !== 'match' ||
      command.precondition.revision !== REVISION
    ) {
      throw new TodayRevisionConflictError(REVISION);
    }
    return Object.freeze({ kind: 'updated', aggregate: AGGREGATE });
  }
}

describe('Today If-Match strong comparison boundary', () => {
  it('preserves entity-tag octets while parsing a valid strong If-Match', () => {
    const uppercaseRevision = REVISION.toUpperCase();

    expect(
      parseTodayWritePrecondition(`\"${uppercaseRevision}\"`, undefined),
    ).toEqual({ kind: 'match', revision: uppercaseRevision });
  });

  it('does not recanonicalize a case-changed revision into update authority', async () => {
    const service = new TodaySyncService(new ExactRevisionRepository());

    await expect(
      service.putToday(
        WORKSPACE_ID,
        DRAFT,
        { kind: 'match', revision: REVISION.toUpperCase() },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toEqual(new TodayRevisionConflictError(REVISION));
  });
});
