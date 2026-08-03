interface SyntheticOAuthCallbackRequest {
  query: {
    return_to: string;
  };
}

interface SyntheticOAuthCallbackResponse {
  redirect(location: string): void;
}

/**
 * Intentionally redirects to callback request input for detector regression.
 */
export function completeUnsafeOAuthCallbackFixture(
  request: SyntheticOAuthCallbackRequest,
  response: SyntheticOAuthCallbackResponse,
): void {
  response.redirect(request.query.return_to);
}
