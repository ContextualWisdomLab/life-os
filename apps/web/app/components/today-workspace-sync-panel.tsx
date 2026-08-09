'use client';

import { useState } from 'react';
import type { MessageCatalog } from '../localization';
import type { TodayDraft } from '../today-state';
import {
  fetchWorkspaceToday,
  saveWorkspaceToday,
} from '../today-workspace-sync';

type SyncState =
  | 'local'
  | 'checking'
  | 'missing'
  | 'found'
  | 'saved'
  | 'loaded'
  | 'conflict'
  | 'unauthenticated'
  | 'unavailable';

function statusMessage(messages: MessageCatalog, state: SyncState): string {
  switch (state) {
    case 'checking':
      return messages.workspaceCheckingStatus;
    case 'missing':
      return messages.workspaceMissingStatus;
    case 'found':
      return messages.workspaceFoundStatus;
    case 'saved':
      return messages.workspaceSavedStatus;
    case 'loaded':
      return messages.workspaceLoadedStatus;
    case 'conflict':
      return messages.workspaceConflictStatus;
    case 'unauthenticated':
      return messages.workspaceSignInStatus;
    case 'unavailable':
      return messages.workspaceUnavailableStatus;
    case 'local':
    default:
      return messages.workspaceLocalOnlyStatus;
  }
}

/**
 * Presents explicit local/durable choices. It intentionally performs no
 * network request on mount so a browser-local draft can never be uploaded or
 * even reconciled until the user chooses an action.
 */
export function TodayWorkspaceSyncPanel({
  draft,
  messages,
  onUseDraft,
}: {
  readonly draft: TodayDraft;
  readonly messages: MessageCatalog;
  readonly onUseDraft: (draft: TodayDraft) => void;
}) {
  const [state, setState] = useState<SyncState>('local');
  const [workspaceDraft, setWorkspaceDraft] = useState<TodayDraft | null>(null);
  const [workspaceRevision, setWorkspaceRevision] = useState<string | null>(null);

  async function checkWorkspace(): Promise<void> {
    setState('checking');
    const result = await fetchWorkspaceToday(draft.date);
    switch (result.kind) {
      case 'found':
        setWorkspaceDraft(result.draft);
        setWorkspaceRevision(result.revision);
        setState('found');
        return;
      case 'missing':
        setWorkspaceDraft(null);
        setWorkspaceRevision(null);
        setState('missing');
        return;
      case 'unauthenticated':
        setWorkspaceDraft(null);
        setWorkspaceRevision(null);
        setState('unauthenticated');
        return;
      case 'unavailable':
      default:
        setWorkspaceDraft(null);
        setWorkspaceRevision(null);
        setState('unavailable');
    }
  }

  async function saveLocal(): Promise<void> {
    if (
      state !== 'missing' &&
      state !== 'found' &&
      state !== 'saved' &&
      state !== 'loaded'
    ) {
      return;
    }
    setState('checking');
    const result = await saveWorkspaceToday(draft, workspaceRevision);
    switch (result.kind) {
      case 'saved':
        setWorkspaceDraft(result.draft);
        setWorkspaceRevision(result.revision);
        onUseDraft(result.draft);
        setState('saved');
        return;
      case 'conflict':
        setWorkspaceDraft(null);
        setWorkspaceRevision(null);
        setState('conflict');
        return;
      case 'unauthenticated':
        setWorkspaceDraft(null);
        setWorkspaceRevision(null);
        setState('unauthenticated');
        return;
      case 'unavailable':
      default:
        setState('unavailable');
    }
  }

  function useWorkspace(): void {
    if (!workspaceDraft || state !== 'found') return;
    onUseDraft(workspaceDraft);
    setState('loaded');
  }

  const canSave =
    state === 'missing' ||
    state === 'found' ||
    state === 'saved' ||
    state === 'loaded';
  const saveLabel =
    state === 'missing'
      ? messages.moveLocalToWorkspace
      : state === 'found'
        ? messages.replaceWorkspaceWithLocal
        : messages.saveLocalToWorkspace;

  return (
    <section className="list-card" aria-labelledby="workspace-sync-heading">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">{messages.workspaceSyncEyebrow}</p>
          <h2 id="workspace-sync-heading">{messages.workspaceSyncHeading}</h2>
        </div>
        <span>{state === 'saved' || state === 'loaded' ? '✓' : '↔'}</span>
      </div>
      <p>{messages.workspaceSyncDescription}</p>
      <p aria-live="polite" role="status">
        {statusMessage(messages, state)}
      </p>
      <div className="schedule-controls">
        <button
          type="button"
          disabled={state === 'checking'}
          onClick={() => void checkWorkspace()}
        >
          {messages.checkWorkspaceToday}
        </button>
        {canSave ? (
          <button
            type="button"
            disabled={state === 'checking'}
            onClick={() => void saveLocal()}
          >
            {saveLabel}
          </button>
        ) : null}
        {state === 'found' && workspaceDraft ? (
          <button type="button" onClick={useWorkspace}>
            {messages.useWorkspaceToday}
          </button>
        ) : null}
      </div>
    </section>
  );
}
