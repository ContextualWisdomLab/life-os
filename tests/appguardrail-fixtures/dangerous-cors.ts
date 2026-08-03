interface SyntheticResponse {
  setHeader(name: string, value: string): void;
}

/**
 * Installs an intentionally unsafe wildcard CORS header for detector regression tests.
 */
export function configureUnsafeCorsFixture(response: SyntheticResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
}
