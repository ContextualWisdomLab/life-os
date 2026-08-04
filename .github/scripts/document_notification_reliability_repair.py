from pathlib import Path

path = Path('apps/notification-service/src/notification-runtime.ts')
text = path.read_text()
replacements = [
    (
        """export interface NotificationPoolErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown;
}
""",
        """export interface NotificationPoolErrorSource {
  /** Subscribes to unexpected idle-client failures emitted by the pool. */
  on(event: 'error', listener: (error: Error) => void): unknown;
}
""",
    ),
    (
        """function defaultNotificationPoolErrorLogger(
""",
        """/** Emits one fixed error record without serializing the database error. */
function defaultNotificationPoolErrorLogger(
""",
    ),
]
for old, new in replacements:
    if new in text:
        continue
    if text.count(old) != 1:
        raise RuntimeError(f'expected one runtime docstring anchor, found {text.count(old)}')
    text = text.replace(old, new, 1)
path.write_text(text)
