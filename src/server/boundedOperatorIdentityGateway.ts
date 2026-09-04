import {
  createOperatorIdentityGateway,
  type OperatorAuthorizationDecision,
  type OperatorGatewayDependencies,
  type OperatorSessionDecision,
} from './operatorIdentityGateway';

function abortError(): DOMException {
  return new DOMException('Operator gateway deadline exceeded', 'AbortError');
}

function raceWithAbort<T>(signal: AbortSignal, operation: Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export function createBoundedOperatorIdentityGateway(
  dependencies: OperatorGatewayDependencies,
): (request: Request) => Promise<Response> {
  const boundedDependencies: OperatorGatewayDependencies = {
    ...dependencies,
    verifySession(request, signal): Promise<OperatorSessionDecision> {
      return raceWithAbort(signal, dependencies.verifySession(request, signal));
    },
    resolveAuthorization(session, signal): Promise<OperatorAuthorizationDecision> {
      return raceWithAbort(signal, dependencies.resolveAuthorization(session, signal));
    },
    aggregateReadOnlyEvidence(scope, signal): Promise<unknown> {
      return raceWithAbort(signal, dependencies.aggregateReadOnlyEvidence(scope, signal));
    },
  };

  return createOperatorIdentityGateway(boundedDependencies);
}
