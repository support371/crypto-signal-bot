await import('./verify-operator-frontend-core-safety.mjs');
await import('./verify-operator-identity-gateway-foundation.mjs');
await import('./verify-certification-status-mirror.mjs');
await import('./verify-certification-release-identity.mjs');

console.log('operator frontend, gateway, certification mirror, and release identity safety verified');
