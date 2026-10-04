import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CANONICAL_WORKER_ACCOUNT_ID, verifyWorkerDeploymentTarget } from '../../scripts/verify-worker-deployment-target.mjs';

test('the verified canonical account can deploy', () => {
  assert.equal(verifyWorkerDeploymentTarget({ CLOUDFLARE_ACCOUNT_ID: CANONICAL_WORKER_ACCOUNT_ID }), CANONICAL_WORKER_ACCOUNT_ID);
});

test('absent build account selection fails closed even with credentials', () => {
  assert.throws(() => verifyWorkerDeploymentTarget({ CLOUDFLARE_API_TOKEN: 'private-fixture' }), /deployment\/build environment/);
});

test('the historical account is rejected before any resource mutation', () => {
  assert.throws(() => verifyWorkerDeploymentTarget({ CLOUDFLARE_ACCOUNT_ID: '5918df72bfd0d0389a1894adec5db58f' }), /Deployment blocked/);
});

test('unknown, malformed and whitespace-padded accounts cannot deploy', () => {
  for (const value of ['a'.repeat(32), '', 'invalid', ` ${CANONICAL_WORKER_ACCOUNT_ID}`, `${CANONICAL_WORKER_ACCOUNT_ID}\n`]) {
    assert.throws(() => verifyWorkerDeploymentTarget({ CLOUDFLARE_ACCOUNT_ID: value }));
  }
});

test('CLI rejects the wrong account without revealing credentials or untrusted environment values', () => {
  const script = fileURLToPath(new URL('../../scripts/verify-worker-deployment-target.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'untrusted-fixture', CLOUDFLARE_API_TOKEN: 'private-fixture' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Deployment blocked/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-fixture|untrusted-fixture/);
});

test('npm deployment blocks the historical account even when lifecycle hooks are disabled', () => {
  const workerDirectory = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy'], {
    cwd: workerDirectory,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '5918df72bfd0d0389a1894adec5db58f', CLOUDFLARE_API_TOKEN: 'private-fixture', npm_config_ignore_scripts: 'true' },
    timeout: 20_000,
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Deployment blocked/);
  assert.doesNotMatch(result.stdout + result.stderr, /command not found|not recognized|private-fixture/);
});
