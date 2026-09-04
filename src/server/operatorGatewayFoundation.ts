import { createBoundedOperatorIdentityGateway } from './boundedOperatorIdentityGateway';
import { createOperatorAuthorizationResolver } from './operatorAuthorizationResolver';
import type { OperatorAuthorizationResolverDependencies } from './operatorAuthorizationResolver';
import { createOperatorReadOnlyAggregator } from './operatorReadOnlyAggregator';
import type { OperatorReadOnlyAggregatorDependencies } from './operatorReadOnlyAggregator';
import { createTrustedOperatorSessionVerifier } from './trustedOperatorSessionVerifier';
import type {
  TrustedOperatorSessionVerifierConfig,
  TrustedOperatorSessionVerifierDependencies,
} from './trustedOperatorSessionVerifier';

export interface OperatorGatewayFoundationConfig {
  session: TrustedOperatorSessionVerifierConfig;
  timeoutMs?: number;
}

export interface OperatorGatewayFoundationDependencies {
  session: Omit<TrustedOperatorSessionVerifierDependencies, 'now'>;
  authorization: Omit<OperatorAuthorizationResolverDependencies, 'now'>;
  evidence: Omit<OperatorReadOnlyAggregatorDependencies, 'now'>;
  now: () => Date;
}

export function createDisconnectedOperatorGatewayFoundation(
  config: OperatorGatewayFoundationConfig,
  dependencies: OperatorGatewayFoundationDependencies,
): (request: Request) => Promise<Response> {
  const verifySession = createTrustedOperatorSessionVerifier(config.session, {
    ...dependencies.session,
    now: dependencies.now,
  });
  const resolveAuthorization = createOperatorAuthorizationResolver({
    ...dependencies.authorization,
    now: dependencies.now,
  });
  const aggregateReadOnlyEvidence = createOperatorReadOnlyAggregator({
    ...dependencies.evidence,
    now: dependencies.now,
  });

  return createBoundedOperatorIdentityGateway({
    verifySession,
    resolveAuthorization,
    aggregateReadOnlyEvidence,
    now: dependencies.now,
    timeoutMs: config.timeoutMs,
  });
}
