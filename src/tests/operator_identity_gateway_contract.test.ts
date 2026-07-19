import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('operator identity gateway review contract', () => {
  it('requires server-verified identity, assurance, scope, and read-only aggregation', async () => {
    const contract = await readFile(
      new URL('../../docs/OPERATOR_IDENTITY_GATEWAY_CONTRACT.md', import.meta.url),
      'utf8',
    );

    for (const required of [
      'server-verified session',
      'Issuer and audience are exact and configured server-side.',
      'Multi-factor or step-up assurance',
      'Active roles are resolved server-side',
      'OPERATIONAL_REHEARSAL',
      'GET or HEAD only',
      'no automatic retry',
      'The current 503 placeholder may be replaced only after',
      'does not permit a Bitget demo request',
    ]) {
      expect(contract).toContain(required);
    }

    for (const forbidden of [
      'liveExecutionAllowed = true',
      'realFundsAllowed = true',
      'mainnetAllowed = true',
      'withdrawalsAllowed = true',
      'automaticRetryAllowed = true',
    ]) {
      expect(contract).not.toContain(forbidden);
    }
  });

  it('parses the sanitized response schema and fixes every capability to false', async () => {
    const source = await readFile(
      new URL('../../contracts/operator-readiness-response.schema.json', import.meta.url),
      'utf8',
    );
    const schema = JSON.parse(source) as Record<string, unknown>;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(source).toContain('"OPERATIONAL_REHEARSAL"');
    expect(source).toContain('"READY_FOR_INDEPENDENT_REVIEW"');

    for (const capability of [
      'deploymentAllowed',
      'demoRequestAllowed',
      'credentialsRead',
      'providerMutationAllowed',
      'executionAllowed',
      'liveExecutionAllowed',
      'realFundsAllowed',
      'mainnetAllowed',
      'withdrawalsAllowed',
      'automaticRetryAllowed',
      'accountingAutomaticallyDispatched',
    ]) {
      expect(source).toContain(`"${capability}": { "const": false }`);
    }
  });
});
