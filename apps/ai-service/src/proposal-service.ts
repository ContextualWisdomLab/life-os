import { randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAXIMUM_OBJECTIVE_LENGTH = 2_000;
const MAXIMUM_CONTEXT_ITEMS = 200;
const MAXIMUM_TEXT_LENGTH = 1_000;
const MAXIMUM_RATIONALE_ITEMS = 20;
const MAXIMUM_OPERATIONS = 20;
const TRUNCATION_MARKER = '…';

/** Read-only planning evidence supplied to proposal generation. */
export interface ProposalContextItem {
  readonly id: string;
  readonly kind: 'goal' | 'project' | 'milestone' | 'task' | 'habit';
  readonly title: string;
  readonly status: 'active' | 'blocked' | 'completed';
}

/** Validated proposal-generation input owned by one workspace. */
export interface ProposalRequest {
  readonly objective: string;
  readonly context: readonly ProposalContextItem[];
}

/** One user-confirmable operation suggested by the model. */
export interface ProposalOperation {
  readonly kind: 'create_task' | 'prioritize_item' | 'schedule_item';
  readonly description: string;
  readonly targetId?: string;
}

/** Immutable, explainable output that cannot execute its own operations. */
export interface AuditableProposal {
  readonly proposalId: string;
  readonly workspaceId: string;
  readonly summary: string;
  readonly rationale: readonly string[];
  readonly operations: readonly ProposalOperation[];
  readonly requiresConfirmation: true;
  readonly createdAt: string;
}

/** Untrusted structured output returned by a proposal model adapter. */
export interface ProposalModelDraft {
  readonly summary: unknown;
  readonly rationale: unknown;
  readonly operations: unknown;
}

/** Read-only model boundary. It receives evidence and returns suggestions only. */
export interface ProposalModel {
  generate(input: ProposalRequest): Promise<ProposalModelDraft>;
}

export type ProposalClock = () => Date;
export type ProposalIdFactory = () => string;

/** Stable validation failure suitable for bounded HTTP error mapping. */
export class ProposalValidationError extends Error {
  constructor() {
    super('Proposal request or model output is invalid');
    this.name = 'ProposalValidationError';
  }
}

function invalid(): never {
  throw new ProposalValidationError();
}

function requireString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    return invalid();
  }
  return normalized;
}

function requireUuidV4(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): void {
  const expected = new Set(expectedKeys);
  const actual = Object.keys(record);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    invalid();
  }
}

function requireContextItem(value: unknown): ProposalContextItem {
  const record = requireRecord(value);
  requireExactKeys(record, ['id', 'kind', 'title', 'status']);
  const kind = record.kind;
  const status = record.status;
  if (
    kind !== 'goal' &&
    kind !== 'project' &&
    kind !== 'milestone' &&
    kind !== 'task' &&
    kind !== 'habit'
  ) {
    return invalid();
  }
  if (status !== 'active' && status !== 'blocked' && status !== 'completed') {
    return invalid();
  }
  return Object.freeze({
    id: requireUuidV4(record.id),
    kind,
    title: requireString(record.title, MAXIMUM_TEXT_LENGTH),
    status,
  });
}

/** Validates and snapshots untrusted request data before model invocation. */
export function validateProposalRequest(value: unknown): ProposalRequest {
  const record = requireRecord(value);
  requireExactKeys(record, ['objective', 'context']);
  if (
    !Array.isArray(record.context) ||
    record.context.length > MAXIMUM_CONTEXT_ITEMS
  ) {
    return invalid();
  }
  const context = record.context.map(requireContextItem);
  return Object.freeze({
    objective: requireString(record.objective, MAXIMUM_OBJECTIVE_LENGTH),
    context: Object.freeze(context),
  });
}

function validateRationale(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAXIMUM_RATIONALE_ITEMS
  ) {
    return invalid();
  }
  return Object.freeze(
    value.map((item) => requireString(item, MAXIMUM_TEXT_LENGTH)),
  );
}

function validateOperation(value: unknown): ProposalOperation {
  const record = requireRecord(value);
  const hasTargetId = Object.hasOwn(record, 'targetId');
  requireExactKeys(
    record,
    hasTargetId ? ['kind', 'description', 'targetId'] : ['kind', 'description'],
  );
  const kind = record.kind;
  if (
    kind !== 'create_task' &&
    kind !== 'prioritize_item' &&
    kind !== 'schedule_item'
  ) {
    return invalid();
  }
  const description = requireString(record.description, MAXIMUM_TEXT_LENGTH);
  if (!hasTargetId) {
    return Object.freeze({ kind, description });
  }
  return Object.freeze({
    kind,
    description,
    targetId: requireUuidV4(record.targetId),
  });
}

function validateOperations(value: unknown): readonly ProposalOperation[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAXIMUM_OPERATIONS
  ) {
    return invalid();
  }
  return Object.freeze(value.map(validateOperation));
}

function boundedInterpolation(
  prefix: string,
  value: string,
  suffix: string,
): string {
  const available = MAXIMUM_TEXT_LENGTH - prefix.length - suffix.length;
  if (available < TRUNCATION_MARKER.length) {
    return invalid();
  }
  const boundedValue =
    value.length <= available
      ? value
      : `${value.slice(0, available - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
  return `${prefix}${boundedValue}${suffix}`;
}

/** A deterministic local adapter used until a bounded external model is wired. */
export class RuleBasedProposalModel implements ProposalModel {
  async generate(input: ProposalRequest): Promise<ProposalModelDraft> {
    const actionable = input.context.find(
      (item) => item.status !== 'completed',
    );
    if (actionable) {
      return {
        summary: boundedInterpolation(
          'Focus the next action on ',
          actionable.title,
          '.',
        ),
        rationale: [
          `The item is ${actionable.status} and directly supports the stated objective.`,
          'No user-owned record will change until the proposal is explicitly confirmed.',
        ],
        operations: [
          {
            kind: 'prioritize_item',
            targetId: actionable.id,
            description: boundedInterpolation(
              'Prioritize ',
              actionable.title,
              ' for explicit user review.',
            ),
          },
        ],
      };
    }
    return {
      summary: 'Create one concrete next task for the objective.',
      rationale: [
        'No active planning item was supplied as proposal evidence.',
        'The suggested task remains inert until explicit confirmation.',
      ],
      operations: [
        {
          kind: 'create_task',
          description: boundedInterpolation(
            'Create a task for: ',
            input.objective,
            '',
          ),
        },
      ],
    };
  }
}

/** Generates inert proposals without receiving any write-capable dependency. */
export class ProposalService {
  constructor(
    private readonly model: ProposalModel,
    private readonly clock: ProposalClock = () => new Date(),
    private readonly idFactory: ProposalIdFactory = randomUUID,
  ) {}

  async generateProposal(
    workspaceId: string,
    request: ProposalRequest,
  ): Promise<AuditableProposal> {
    const validatedWorkspaceId = requireUuidV4(workspaceId);
    const validatedRequest = validateProposalRequest(request);
    const draft = await this.model.generate(validatedRequest);
    const createdAt = this.clock();
    if (Number.isNaN(createdAt.getTime())) {
      return invalid();
    }
    return Object.freeze({
      proposalId: requireUuidV4(this.idFactory()),
      workspaceId: validatedWorkspaceId,
      summary: requireString(draft.summary, MAXIMUM_TEXT_LENGTH),
      rationale: validateRationale(draft.rationale),
      operations: validateOperations(draft.operations),
      requiresConfirmation: true,
      createdAt: createdAt.toISOString(),
    });
  }
}
