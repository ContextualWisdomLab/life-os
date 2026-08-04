#!/usr/bin/env python3
"""Apply the final evidence-backed notification review repairs."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    """Replace one exact reviewed block and fail closed if the code moved."""
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected: int) -> None:
    """Replace an exact reviewed expression a known number of times."""
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count == 0 and new in text:
        return
    if count != expected:
        raise RuntimeError(
            f"expected {expected} matches in {path}, found {count}"
        )
    target.write_text(text.replace(old, new), encoding="utf-8")


scheduler = "apps/notification-service/src/reminder-scheduler.ts"
replace_once(
    scheduler,
    """  claim(workspaceId: string, reminderId: string): Promise<string | null>;
""",
    """  claim(
    workspaceId: string,
    reminderId: string,
    dueAt: string,
    deliveryAttempt: number,
  ): Promise<string | null>;
""",
)
replace_once(
    scheduler,
    """function idempotencyKey(reminder: ReminderOccurrence): string {
  return `${reminder.workspaceId}:${reminder.id}:${reminder.dueAt}`;
}
""",
    """/** Builds the stable tenant-scoped key used for idempotent delivery. */
export function idempotencyKey(reminder: ReminderOccurrence): string {
  return `${reminder.workspaceId}:${reminder.id}:${reminder.dueAt}`;
}
""",
)
replace_once(
    scheduler,
    """      const claimKey = await this.repository.claim(
        reminder.workspaceId,
        reminder.id,
      );
""",
    """      const claimKey = await this.repository.claim(
        reminder.workspaceId,
        reminder.id,
        reminder.dueAt,
        reminder.deliveryAttempt,
      );
""",
)

repository = "apps/notification-service/src/postgres-reminder-repository.ts"
replace_once(
    repository,
    """  async claim(workspaceId: string, reminderId: string): Promise<string | null> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeReminderId = requireUuid(reminderId);
    const claimKey = requireUuid(this.claimKeyFactory());
    const result = await this.query<IdentifierRow>(
      `UPDATE notification_service.reminder_occurrences
       SET claim_key_hash = $3,
           claim_expires_at = clock_timestamp()
             + make_interval(secs => $4),
           updated_at = clock_timestamp()
       WHERE workspace_id = $1
         AND reminder_id = $2
         AND occurrence_status = 'pending'
         AND (claim_expires_at IS NULL OR claim_expires_at <= clock_timestamp())
       RETURNING reminder_id`,
      [
        safeWorkspaceId,
        safeReminderId,
        hashNotificationIdempotencyKey(claimKey),
        this.claimLeaseSeconds,
      ],
    );
""",
    """  async claim(
    workspaceId: string,
    reminderId: string,
    dueAt: string,
    deliveryAttempt: number,
  ): Promise<string | null> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeReminderId = requireUuid(reminderId);
    const safeDueAt = requireTimestamp(dueAt);
    const safeDeliveryAttempt = requireInteger(
      deliveryAttempt,
      0,
      MAX_DELIVERY_ATTEMPTS,
    );
    const claimKey = requireUuid(this.claimKeyFactory());
    const result = await this.query<IdentifierRow>(
      `UPDATE notification_service.reminder_occurrences
       SET claim_key_hash = $3,
           claim_expires_at = clock_timestamp()
             + make_interval(secs => $4),
           updated_at = clock_timestamp()
       WHERE workspace_id = $1
         AND reminder_id = $2
         AND occurrence_status = 'pending'
         AND due_instant = $5
         AND delivery_attempt_count = $6
         AND (claim_expires_at IS NULL OR claim_expires_at <= clock_timestamp())
       RETURNING reminder_id`,
      [
        safeWorkspaceId,
        safeReminderId,
        hashNotificationIdempotencyKey(claimKey),
        this.claimLeaseSeconds,
        safeDueAt,
        safeDeliveryAttempt,
      ],
    );
""",
)

unit_test = "apps/notification-service/src/postgres-reminder-repository.test.ts"
replace_all(
    unit_test,
    "repository.claim(workspaceId, reminderId)",
    "repository.claim(\n        workspaceId,\n        reminderId,\n        reminder().dueAt,\n        reminder().deliveryAttempt,\n      )",
    1,
)
replace_all(
    unit_test,
    ").claim(workspaceId, reminderId)",
    ").claim(\n        workspaceId,\n        reminderId,\n        reminder().dueAt,\n        reminder().deliveryAttempt,\n      )",
    2,
)
replace_once(
    unit_test,
    """    expect(call?.text).toContain('make_interval(secs => $4)');
    expect(call?.values?.[0]).toBe(workspaceId);
    expect(call?.values?.[1]).toBe(reminderId);
    expect(call?.values?.[2]).toEqual(hashNotificationIdempotencyKey(claimKey));
    expect(call?.values?.[3]).toBe(600);
""",
    """    expect(call?.text).toContain('make_interval(secs => $4)');
    expect(call?.text).toContain('due_instant = $5');
    expect(call?.text).toContain('delivery_attempt_count = $6');
    expect(call?.values?.[0]).toBe(workspaceId);
    expect(call?.values?.[1]).toBe(reminderId);
    expect(call?.values?.[2]).toEqual(hashNotificationIdempotencyKey(claimKey));
    expect(call?.values?.[3]).toBe(600);
    expect(call?.values?.[4]).toBe(reminder().dueAt);
    expect(call?.values?.[5]).toBe(reminder().deliveryAttempt);
""",
)
replace_once(
    unit_test,
    """      expect(call.values).toContainEqual(
        hashNotificationIdempotencyKey(idempotencyKey),
      );
""",
    """      const claimDigest = hashNotificationIdempotencyKey(claimKey);
      const deliveryDigest = hashNotificationIdempotencyKey(idempotencyKey);
      expect(call.values).toContainEqual(deliveryDigest);
      expect(call.values).toContainEqual(claimDigest);
      expect(claimDigest).not.toEqual(deliveryDigest);
""",
)

scheduler_test = "apps/notification-service/src/reminder-scheduler.test.ts"
replace_once(
    scheduler_test,
    """  async claim(): Promise<string | null> {
    return 'noop-claim-key';
  }
""",
    """  async claim(
    _workspaceId: string,
    _reminderId: string,
    _dueAt: string,
    _deliveryAttempt: number,
  ): Promise<string | null> {
    return 'noop-claim-key';
  }
""",
)

scheduler_integration = (
    "apps/notification-service/src/reminder-scheduler.integration.test.ts"
)
replace_once(
    scheduler_integration,
    """  async claim(workspaceId: string, reminderId: string): Promise<string | null> {
    const occurrenceKey = `${workspaceId}:${reminderId}`;
""",
    """  async claim(
    workspaceId: string,
    reminderId: string,
    _dueAt: string,
    _deliveryAttempt: number,
  ): Promise<string | null> {
    const occurrenceKey = `${workspaceId}:${reminderId}`;
""",
)

postgres_integration = (
    "apps/notification-service/src/postgres-reminder-repository.integration.test.ts"
)
replace_once(
    postgres_integration,
    """import {
  ReminderScheduler,
  type ReminderOccurrence,
} from './reminder-scheduler';
""",
    """import {
  ReminderScheduler,
  idempotencyKey,
  type ReminderOccurrence,
} from './reminder-scheduler';
""",
)
replace_all(
    postgres_integration,
    "durableRepository.claim(workspaceId, reminder.id)",
    "durableRepository.claim(\n          workspaceId,\n          reminder.id,\n          reminder.dueAt,\n          reminder.deliveryAttempt,\n        )",
    4,
)
replace_once(
    postgres_integration,
    """    const deliveryKey = `${workspaceId}:${reminder.id}:${reminder.dueAt}`;
""",
    """    const deliveryKey = idempotencyKey(reminder);
""",
)
replace_once(
    postgres_integration,
    """    const key = `${workspaceId}:${reminder.id}:${reminder.dueAt}`;
""",
    """    const key = idempotencyKey(reminder);
""",
)
replace_once(
    postgres_integration,
    """  it('fences an expired owner after a replacement claim is acquired', async () => {
""",
    """  it('rejects a claim when the observed row version has changed', async () => {
    const workspaceId = randomUUID();
    const reminder = occurrence(workspaceId);
    const durableRepository = repository(administrativePool, 300);
    await durableRepository.schedule(reminder);
    const [observed] = await durableRepository.listDue(
      '2026-08-04T12:01:00.000Z',
      10,
    );
    if (observed === undefined) {
      throw new Error('expected one due reminder');
    }
    await administrativePool.query(
      `UPDATE notification_service.reminder_occurrences
       SET due_instant = due_instant + interval '1 minute',
           delivery_attempt_count = delivery_attempt_count + 1
       WHERE workspace_id = $1 AND reminder_id = $2`,
      [workspaceId, reminder.id],
    );

    await expect(
      durableRepository.claim(
        observed.workspaceId,
        observed.id,
        observed.dueAt,
        observed.deliveryAttempt,
      ),
    ).resolves.toBeNull();
  });

  it('fences an expired owner after a replacement claim is acquired', async () => {
""",
)

package_path = ROOT / "apps/notification-service/package.json"
package_data = json.loads(package_path.read_text(encoding="utf-8"))
package_data["scripts"]["lint"] = (
    "tsc --noEmit && prettier --single-quote --check "
    "package.json tsconfig.json vitest.config.ts \"src/**/*.ts\" "
    "../../CHANGELOG.md ../../docs/operations/notification-persistence.md "
    "../../docs/superpowers/specs/2026-08-04-notification-postgres-inbox-design.md "
    "\"../../docs/superpowers/plans/2026-08-04-*.md\""
)
package_path.write_text(
    json.dumps(package_data, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)

workflow_path = ROOT / ".github/workflows/ci.yml"
workflow = workflow_path.read_text(encoding="utf-8")
validate_index = workflow.index("  validate:\n")
preamble = workflow[: workflow.index("jobs:\n")]
validate = workflow[validate_index:]
validate = validate.replace(
    """    needs: review_repair
    if: >-
      always() &&
      (needs.review_repair.result == 'success' ||
       needs.review_repair.result == 'skipped')
""",
    "",
    1,
)
workflow_path.write_text(
    preamble
    + "# exact-head verification trigger; remove after the reviewed repair commit.\n"
    + "jobs:\n"
    + validate,
    encoding="utf-8",
)
