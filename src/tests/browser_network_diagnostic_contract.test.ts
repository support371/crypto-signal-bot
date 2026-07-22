import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('browser network diagnostic contract', () => {
  it('compares only the server and browser health paths without credentials', async () => {
    const [html, script] = await Promise.all([
      readFile(new URL('../../public/browser-network-diagnostic.html', import.meta.url), 'utf8'),
      readFile(new URL('../../public/browser-network-diagnostic.js', import.meta.url), 'utf8'),
    ]);

    expect(html).toContain('Browser network diagnostic');
    expect(html).toContain('Platform server → Worker');
    expect(html).toContain('This browser → Worker');
    expect(html).toContain("connect-src 'self' https://*.workers.dev");
    expect(html).toContain('/browser-network-diagnostic.js');

    expect(script).toContain("const SERVER_DIAGNOSTIC_ROUTE = '/api/certification/backend-health'");
    expect(script).toContain('const REQUEST_TIMEOUT_MS = 6_000');
    expect(script).toContain("host.endsWith('.workers.dev')");
    expect(script).toContain('`https://${host}/health`');
    expect(script).toContain("method: 'GET'");
    expect(script).toContain("credentials: 'omit'");
    expect(script).toContain("redirect: 'error'");
    expect(script).toContain("cache: 'no-store'");
    expect(script).toContain('void runDiagnostic();');

    expect(script.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(script).not.toMatch(/authorization/i);
    expect(script).not.toMatch(/document\.cookie/i);
    expect(script).not.toMatch(/localStorage/i);
    expect(script).not.toMatch(/sessionStorage/i);
    expect(script).not.toMatch(/credentials:\s*'include'/i);
    expect(script).not.toMatch(/setInterval/i);
  });

  it('does not read the direct Worker response body or retry automatically', async () => {
    const script = await readFile(new URL('../../public/browser-network-diagnostic.js', import.meta.url), 'utf8');
    const start = script.indexOf('async function readBrowserPath');
    const end = script.indexOf('function renderInterpretation');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const browserPath = script.slice(start, end);
    expect(browserPath).not.toMatch(/\.json\s*\(/i);
    expect(browserPath).not.toMatch(/\.text\s*\(/i);
    expect(browserPath).not.toMatch(/\.arrayBuffer\s*\(/i);
    expect(browserPath).not.toMatch(/\.blob\s*\(/i);
    expect(browserPath).not.toMatch(/\.formData\s*\(/i);
    expect(browserPath).not.toMatch(/\.body\b/i);
    expect(script.match(/readBrowserPath\s*\(/g)).toHaveLength(2);
  });
});
