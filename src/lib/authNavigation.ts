export function resolvePostAuthPath(from: unknown): string {
  if (typeof from !== 'string') return '/dashboard';

  const candidate = from.trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return '/dashboard';
  }

  return candidate === '/auth' ? '/dashboard' : candidate;
}
