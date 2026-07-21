import type {
  OperatorAssuranceLevel,
  OperatorSessionDecision,
  VerifiedOperatorSession,
} from './operatorIdentityGateway';

export interface VerifiedIdentityClaims {
  issuer: string;
  audience: string;
  subject: string;
  sessionId: string;
  assuranceLevel: OperatorAssuranceLevel;
  issuedAt: string;
  authenticatedAt: string;
  notBefore: string | null;
  expiresAt: string;
}

export type SignedSessionVerificationDecision =
  | { status: 'VERIFIED'; claims: VerifiedIdentityClaims }
  | { status: 'UNAUTHENTICATED'; reason: string }
  | { status: 'UNAVAILABLE'; reason: string };

export type TrustedSessionStateDecision =
  | { status: 'ACTIVE' }
  | { status: 'REVOKED'; reason: string }
  | { status: 'REPLAYED'; reason: string }
  | { status: 'UNAVAILABLE'; reason: string };

export type OperatorSubjectDecision =
  | { status: 'MAPPED'; subjectId: string }
  | { status: 'DISABLED'; reason: string }
  | { status: 'UNAVAILABLE'; reason: string };

export interface TrustedOperatorSessionVerifierConfig {
  issuer: string;
  audience: string;
  requiredAssurance: OperatorAssuranceLevel;
  maxClockSkewSeconds?: number;
  maxSessionAgeSeconds?: number;
  maxAuthenticationAgeSeconds?: number;
}

export interface TrustedOperatorSessionVerifierDependencies {
  verifySignedSession(
    request: Request,
    signal: AbortSignal,
  ): Promise<SignedSessionVerificationDecision>;
  inspectSessionState(
    claims: VerifiedIdentityClaims,
    signal: AbortSignal,
  ): Promise<TrustedSessionStateDecision>;
  resolveSubject(
    claims: VerifiedIdentityClaims,
    signal: AbortSignal,
  ): Promise<OperatorSubjectDecision>;
  now?: () => Date;
}

type NormalizedConfig = Readonly<{
  issuer: string;
  audience: string;
  requiredAssurance: OperatorAssuranceLevel;
  maxClockSkewMs: number;
  maxSessionAgeMs: number;
  maxAuthenticationAgeMs: number;
}>;

type NormalizedClaims = Readonly<VerifiedIdentityClaims & {
  issuedAtMs: number;
  authenticatedAtMs: number;
  notBeforeMs: number | null;
  expiresAtMs: number;
}>;

const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 30;
const DEFAULT_MAX_SESSION_AGE_SECONDS = 8 * 60 * 60;
const DEFAULT_MAX_AUTHENTICATION_AGE_SECONDS = 60 * 60;

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new TypeError(`${field} is missing or exceeds its limit`);
  }
  return normalized;
}

function canonicalIso(value: unknown, field: string): Readonly<{ value: string; time: number }> {
  const normalized = boundedText(value, field, 64);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
    throw new TypeError(`${field} must be a canonical ISO timestamp`);
  }
  return Object.freeze({ value: normalized, time: parsed });
}

function boundedSeconds(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new TypeError(`${field} must be between ${minimum} and ${maximum} seconds`);
  }
  return candidate;
}

function assuranceRank(value: OperatorAssuranceLevel): number {
  return value === 'AAL3' ? 3 : 2;
}

function normalizeConfig(config: TrustedOperatorSessionVerifierConfig): NormalizedConfig {
  if (config.requiredAssurance !== 'AAL2' && config.requiredAssurance !== 'AAL3') {
    throw new TypeError('requiredAssurance must be AAL2 or AAL3');
  }
  return Object.freeze({
    issuer: boundedText(config.issuer, 'issuer', 512),
    audience: boundedText(config.audience, 'audience', 512),
    requiredAssurance: config.requiredAssurance,
    maxClockSkewMs: boundedSeconds(
      config.maxClockSkewSeconds,
      DEFAULT_MAX_CLOCK_SKEW_SECONDS,
      0,
      300,
      'maxClockSkewSeconds',
    ) * 1_000,
    maxSessionAgeMs: boundedSeconds(
      config.maxSessionAgeSeconds,
      DEFAULT_MAX_SESSION_AGE_SECONDS,
      60,
      86_400,
      'maxSessionAgeSeconds',
    ) * 1_000,
    maxAuthenticationAgeMs: boundedSeconds(
      config.maxAuthenticationAgeSeconds,
      DEFAULT_MAX_AUTHENTICATION_AGE_SECONDS,
      60,
      43_200,
      'maxAuthenticationAgeSeconds',
    ) * 1_000,
  });
}

function normalizeClaims(
  claims: VerifiedIdentityClaims,
  config: NormalizedConfig,
  now: Date,
): NormalizedClaims {
  const issuer = boundedText(claims.issuer, 'claims.issuer', 512);
  const audience = boundedText(claims.audience, 'claims.audience', 512);
  const subject = boundedText(claims.subject, 'claims.subject', 256);
  const sessionId = boundedText(claims.sessionId, 'claims.sessionId', 256);
  if (issuer !== config.issuer || audience !== config.audience) {
    throw new TypeError('session issuer or audience does not match the configured trust boundary');
  }
  if (claims.assuranceLevel !== 'AAL2' && claims.assuranceLevel !== 'AAL3') {
    throw new TypeError('session assurance is malformed');
  }
  if (assuranceRank(claims.assuranceLevel) < assuranceRank(config.requiredAssurance)) {
    throw new TypeError('session assurance is below the operator policy');
  }

  const issuedAt = canonicalIso(claims.issuedAt, 'claims.issuedAt');
  const authenticatedAt = canonicalIso(claims.authenticatedAt, 'claims.authenticatedAt');
  const expiresAt = canonicalIso(claims.expiresAt, 'claims.expiresAt');
  const notBefore = claims.notBefore === null
    ? null
    : canonicalIso(claims.notBefore, 'claims.notBefore');
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) throw new TypeError('current time is invalid');
  if (issuedAt.time > nowMs + config.maxClockSkewMs) {
    throw new TypeError('session was issued in the future');
  }
  if (authenticatedAt.time > nowMs + config.maxClockSkewMs) {
    throw new TypeError('session authentication occurred in the future');
  }
  if (authenticatedAt.time > issuedAt.time + config.maxClockSkewMs) {
    throw new TypeError('session authentication time is inconsistent');
  }
  if (notBefore && notBefore.time > nowMs + config.maxClockSkewMs) {
    throw new TypeError('session is not active yet');
  }
  if (expiresAt.time + config.maxClockSkewMs <= nowMs) {
    throw new TypeError('session is expired');
  }
  if (expiresAt.time <= issuedAt.time) {
    throw new TypeError('session expiry is inconsistent');
  }
  if (nowMs - issuedAt.time > config.maxSessionAgeMs + config.maxClockSkewMs) {
    throw new TypeError('session exceeds its maximum age');
  }
  if (nowMs - authenticatedAt.time > config.maxAuthenticationAgeMs + config.maxClockSkewMs) {
    throw new TypeError('session authentication is too old');
  }

  return Object.freeze({
    issuer,
    audience,
    subject,
    sessionId,
    assuranceLevel: claims.assuranceLevel,
    issuedAt: issuedAt.value,
    authenticatedAt: authenticatedAt.value,
    notBefore: notBefore?.value ?? null,
    expiresAt: expiresAt.value,
    issuedAtMs: issuedAt.time,
    authenticatedAtMs: authenticatedAt.time,
    notBeforeMs: notBefore?.time ?? null,
    expiresAtMs: expiresAt.time,
  });
}

function authenticatedSession(
  subjectId: string,
  claims: NormalizedClaims,
): OperatorSessionDecision {
  const session: VerifiedOperatorSession = Object.freeze({
    subjectId: boundedText(subjectId, 'mapped subjectId', 256),
    assuranceLevel: claims.assuranceLevel,
    expiresAt: claims.expiresAt,
  });
  return Object.freeze({ status: 'AUTHENTICATED', session });
}

function unauthenticated(reason: string): OperatorSessionDecision {
  return Object.freeze({ status: 'UNAUTHENTICATED', reason });
}

function unavailable(reason: string): OperatorSessionDecision {
  return Object.freeze({ status: 'UNAVAILABLE', reason });
}

export function createTrustedOperatorSessionVerifier(
  configInput: TrustedOperatorSessionVerifierConfig,
  dependencies: TrustedOperatorSessionVerifierDependencies,
): (request: Request, signal: AbortSignal) => Promise<OperatorSessionDecision> {
  const config = normalizeConfig(configInput);
  const now = dependencies.now ?? (() => new Date());

  return async (request: Request, signal: AbortSignal): Promise<OperatorSessionDecision> => {
    if (signal.aborted) return unavailable('trusted session verification was aborted');

    let verification: SignedSessionVerificationDecision;
    try {
      verification = await dependencies.verifySignedSession(request, signal);
    } catch {
      return signal.aborted
        ? unavailable('trusted session verification was aborted')
        : unavailable('signed operator session verification is unavailable');
    }
    if (verification.status === 'UNAUTHENTICATED') {
      return unauthenticated('signed operator session is missing or invalid');
    }
    if (verification.status === 'UNAVAILABLE') {
      return unavailable('signed operator session verification is unavailable');
    }
    if (signal.aborted) return unavailable('trusted session verification was aborted');

    let evaluationTime: Date;
    try {
      evaluationTime = now();
      if (!Number.isFinite(evaluationTime.getTime())) throw new TypeError('invalid clock');
    } catch {
      return unavailable('trusted session clock is unavailable');
    }

    let claims: NormalizedClaims;
    try {
      claims = normalizeClaims(verification.claims, config, evaluationTime);
    } catch {
      return unauthenticated('trusted operator session failed validation');
    }
    if (signal.aborted) return unavailable('trusted session verification was aborted');

    let state: TrustedSessionStateDecision;
    try {
      state = await dependencies.inspectSessionState(claims, signal);
    } catch {
      return signal.aborted
        ? unavailable('trusted session verification was aborted')
        : unavailable('operator session state verification is unavailable');
    }
    if (state.status === 'REVOKED') return unauthenticated('operator session is revoked');
    if (state.status === 'REPLAYED') return unauthenticated('operator session replay was rejected');
    if (state.status === 'UNAVAILABLE') {
      return unavailable('operator session state verification is unavailable');
    }
    if (signal.aborted) return unavailable('trusted session verification was aborted');

    let subject: OperatorSubjectDecision;
    try {
      subject = await dependencies.resolveSubject(claims, signal);
    } catch {
      return signal.aborted
        ? unavailable('trusted session verification was aborted')
        : unavailable('operator subject mapping is unavailable');
    }
    if (subject.status === 'DISABLED') {
      return unauthenticated('operator subject is disabled or unmapped');
    }
    if (subject.status === 'UNAVAILABLE') {
      return unavailable('operator subject mapping is unavailable');
    }

    try {
      return authenticatedSession(subject.subjectId, claims);
    } catch {
      return unavailable('operator subject mapping is malformed');
    }
  };
}
