from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    """Replace one reviewed block and fail closed if the expected code moved."""
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    target.write_text(text.replace(old, new, 1))


scheduler = "apps/notification-service/src/reminder-scheduler.ts"
replace_once(
    scheduler,
    """        try {
          await this.repository.defer(
            reminder,
            nextAllowedInstant(now, reminder.timeZone, quietHours, false),
            'quiet_hours',
            claimKey,
            deliveryKey,
          );
          deferred += 1;
        } catch {
          persistenceFailures += 1;
        }
""",
    """        const nextAttemptAt = nextAllowedInstant(
          now,
          reminder.timeZone,
          quietHours,
          false,
        );
        try {
          await this.repository.defer(
            reminder,
            nextAttemptAt,
            'quiet_hours',
            claimKey,
            deliveryKey,
          );
          deferred += 1;
        } catch {
          persistenceFailures += 1;
        }
""",
)
replace_once(
    scheduler,
    """        try {
          await this.repository.defer(
            reminder,
            nextAllowedInstant(now, reminder.timeZone, quietHours, true),
            'daily_limit',
            claimKey,
            deliveryKey,
          );
          deferred += 1;
        } catch {
          persistenceFailures += 1;
        }
""",
    """        const nextAttemptAt = nextAllowedInstant(
          now,
          reminder.timeZone,
          quietHours,
          true,
        );
        try {
          await this.repository.defer(
            reminder,
            nextAttemptAt,
            'daily_limit',
            claimKey,
            deliveryKey,
          );
          deferred += 1;
        } catch {
          persistenceFailures += 1;
        }
""",
)
