from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one repair anchor in {path}")
    target.write_text(text.replace(old, new, 1))


web = "apps/web/app/today-sync-client.ts"
replace_once(
    web,
    "const UUID_V4_PATTERN =\n  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;\n",
    "const UUID_V4_PATTERN =\n  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;\nconst CANONICAL_UUID_V4_PATTERN =\n  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;\n",
)
replace_once(
    web,
    """/** Requires a strong revision ETag returned by planning-service. */
function requireEtag(value: string | null): string {
  const match = /^\"([0-9a-f-]+)\"$/iu.exec(value ?? '');
  if (!match?.[1] || !UUID_V4_PATTERN.test(match[1])) {
    throw new Error('invalid etag');
  }
  return `\"${match[1].toLowerCase()}\"`;
}
""",
    """/** Requires one strong UUID-shaped browser entity-tag without rewriting octets. */
function requireOpaqueRevisionEtag(value: string | null): string {
  const match = /^\"([0-9a-f-]+)\"$/iu.exec(value ?? '');
  if (!match?.[1] || !UUID_V4_PATTERN.test(match[1])) {
    throw new Error('invalid etag');
  }
  return value as string;
}

/** Requires one lowercase-canonical revision ETag produced by Planning. */
function requireCanonicalRevisionEtag(value: string | null): string {
  const match = /^\"([0-9a-f-]+)\"$/u.exec(value ?? '');
  if (!match?.[1] || !CANONICAL_UUID_V4_PATTERN.test(match[1])) {
    throw new Error('invalid etag');
  }
  return value as string;
}
""",
)
replace_once(
    web,
    "const etag = requireEtag(ifMatch);",
    "const etag = requireOpaqueRevisionEtag(ifMatch);",
)
replace_once(
    web,
    "typeof record.currentRevision === 'string' &&\n    UUID_V4_PATTERN.test(record.currentRevision)",
    "typeof record.currentRevision === 'string' &&\n    CANONICAL_UUID_V4_PATTERN.test(record.currentRevision)",
)
replace_once(
    web,
    "return record.currentRevision.toLowerCase();",
    "return record.currentRevision;",
)
replace_once(
    web,
    "!UUID_V4_PATTERN.test(record.aggregateId)",
    "!CANONICAL_UUID_V4_PATTERN.test(record.aggregateId)",
)
replace_once(
    web,
    "!UUID_V4_PATTERN.test(record.revision)",
    "!CANONICAL_UUID_V4_PATTERN.test(record.revision)",
)
replace_once(
    web,
    "const etag = requireEtag(planningResponse.headers.get('etag'));",
    "const etag = requireCanonicalRevisionEtag(\n      planningResponse.headers.get('etag'),\n    );",
)
replace_once(
    web,
    "if (`\"${String(aggregate.revision).toLowerCase()}\"` !== etag) {",
    "if (`\"${String(aggregate.revision)}\"` !== etag) {",
)

workspace = "apps/web/app/today-workspace-sync.ts"
replace_once(
    workspace,
    "const UUID_V4_PATTERN =\n  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;\n",
    "const UUID_V4_PATTERN =\n  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;\n",
)
replace_once(
    workspace,
    "return match[1].toLowerCase();",
    "return match[1];",
)
replace_once(
    workspace,
    "return record.currentRevision.toLowerCase();",
    "return record.currentRevision;",
)
replace_once(
    workspace,
    "else requestHeaders.set('if-match', `\"${revision.toLowerCase()}\"`);",
    "else requestHeaders.set('if-match', `\"${revision}\"`);",
)

planning = "apps/planning-service/src/today-http.ts"
replace_once(
    planning,
    "import { canonicalTodayDate, canonicalTodayUuidV4 } from './today-invariants';",
    "import { canonicalTodayDate } from './today-invariants';",
)
replace_once(
    planning,
    "} from './today-sync';\n\n",
    "} from './today-sync';\n\nconst TODAY_REVISION_ENTITY_TAG_PATTERN =\n  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;\n\n",
)
replace_once(
    planning,
    """  const match = /^\"([^\"\\r\\n]+)\"$/u.exec(ifMatch ?? '');
  if (!match?.[1]) return invalidTodayPrecondition();
  return Object.freeze({
    kind: 'match',
    revision: canonicalTodayUuidV4(match[1], invalidTodayPrecondition),
  });
""",
    """  const match = /^\"([^\"\\r\\n]+)\"$/u.exec(ifMatch ?? '');
  if (!match?.[1] || !TODAY_REVISION_ENTITY_TAG_PATTERN.test(match[1])) {
    return invalidTodayPrecondition();
  }
  return Object.freeze({ kind: 'match', revision: match[1] });
""",
)
