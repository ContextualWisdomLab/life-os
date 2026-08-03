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
  req: SyntheticOAuthCallbackRequest,
  res: SyntheticOAuthCallbackResponse,
): void {
  res.redirect(req.query.return_to);
}
