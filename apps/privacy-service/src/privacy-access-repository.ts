import type { PrivacyAccessDecision } from './privacy-access-domain';
import type { PrivacyAccessGrantClaims } from './privacy-access-token';

/** Persistable decision plus the digest of an issued token when allowed. */
export interface PrivacyDecisionPersistenceInput {
  readonly decision: PrivacyAccessDecision;
  readonly tokenDigest?: string;
}

/** Exact metadata required to atomically consume one privacy grant. */
export interface PrivacyGrantConsumptionInput {
  readonly claims: PrivacyAccessGrantClaims;
  readonly tokenDigest: string;
  readonly accessEventId: string;
  readonly resourceReferenceDigest: string;
  readonly occurredAt: string;
}

/** Immutable receipt returned after exactly one successful grant consumption. */
export interface PrivacyGrantConsumptionReceipt {
  readonly accessEventId: string;
  readonly grantId: string;
  readonly decisionId: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly purpose: PrivacyAccessGrantClaims['purpose'];
  readonly action: PrivacyAccessGrantClaims['action'];
  readonly resourceCategory: PrivacyAccessGrantClaims['resourceCategory'];
  readonly accessMode: PrivacyAccessGrantClaims['accessMode'];
  readonly policyRevisionId: string;
  readonly policyDigest: string;
  readonly occurredAt: string;
}

/** Persistence boundary owned by the independently deployable privacy service. */
export interface PrivacyAccessRepository {
  /** Appends one allowed or denied decision and optional unconsumed grant. */
  persistDecision(input: PrivacyDecisionPersistenceInput): Promise<void>;
  /** Atomically consumes one exact unused grant and appends its access event. */
  consumeGrant(
    input: PrivacyGrantConsumptionInput,
  ): Promise<PrivacyGrantConsumptionReceipt>;
}
