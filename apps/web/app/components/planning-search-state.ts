/** Normalizes a browser search term to the same Unicode and whitespace form as the BFF. */
export function normalizePlanningSearchQuery(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

/** Returns whether an unknown failure is the standard abort exception from fetch. */
export function isPlanningSearchAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Coordinates planning-search requests so only the most recently started request
 * may update the interface. Starting a request aborts its predecessor, while
 * finishing a stale request cannot clear the active request.
 */
export class LatestPlanningSearchRequest {
  private activeController: AbortController | null = null;

  /** Starts a request and cancels the previously active request, when present. */
  begin(): AbortController {
    this.activeController?.abort();
    const controller = new AbortController();
    this.activeController = controller;
    return controller;
  }

  /** Returns whether the supplied controller still owns the visible search state. */
  isCurrent(controller: AbortController): boolean {
    return this.activeController === controller && !controller.signal.aborted;
  }

  /** Releases ownership only when the supplied request is still current. */
  finish(controller: AbortController): void {
    if (this.activeController === controller) {
      this.activeController = null;
    }
  }

  /** Cancels the active request and clears all request ownership. */
  cancel(): void {
    this.activeController?.abort();
    this.activeController = null;
  }
}
