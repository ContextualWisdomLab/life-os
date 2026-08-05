import {
  type ContextualOrchestratorFetch,
  ContextualOrchestratorProposalModel,
  createContextualOrchestratorConfiguration,
} from './contextual-orchestrator-proposal-model';
import {
  type ProposalModel,
  RuleBasedProposalModel,
} from './proposal-service';

/** Supported immutable audit identifiers for proposal model implementations. */
export type ProposalModelId =
  | 'rule-based-v1'
  | 'contextual-orchestrator-v1';

/** Selected proposal model and the exact identifier persisted with its output. */
export interface ProposalModelRuntime {
  readonly model: ProposalModel;
  readonly modelId: ProposalModelId;
}

/** Bounded environment surface used only for explicit proposal model selection. */
type ProposalModelRuntimeEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * Selects one proposal model explicitly. The local rule-based model is the
 * independent default; configured external mode never falls back silently.
 */
export function createProposalModelRuntime(
  environment: ProposalModelRuntimeEnvironment,
  fetcher: ContextualOrchestratorFetch = fetch,
): ProposalModelRuntime {
  const mode = environment.AI_PROPOSAL_MODEL;
  if (mode === undefined || mode === '' || mode === 'rule-based') {
    return Object.freeze({
      model: new RuleBasedProposalModel(),
      modelId: 'rule-based-v1',
    });
  }
  if (mode === 'contextual-orchestrator') {
    return Object.freeze({
      model: new ContextualOrchestratorProposalModel(
        createContextualOrchestratorConfiguration(environment),
        fetcher,
      ),
      modelId: 'contextual-orchestrator-v1',
    });
  }
  throw new Error('AI proposal model is invalid');
}
