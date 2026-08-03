interface SyntheticResponse {
  setHeader(name: string, value: string): void;
}

export function configureUnsafeCorsFixture(response: SyntheticResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
}
