export interface ManagementBootstrapGuardEnv {
  DB: D1Database
}

/**
 * Bootstrap is strictly a first-administrator recovery path.
 * Once any non-revoked, non-expired GLOBAL RELEASE_ADMIN grant exists,
 * the operator-key bootstrap endpoint must remain closed.
 */
export async function hasActiveGlobalReleaseAdmin(
  env: ManagementBootstrapGuardEnv,
  now = new Date().toISOString(),
): Promise<boolean> {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
      FROM live_actor_roles
     WHERE role = 'RELEASE_ADMIN'
       AND scope_type = 'GLOBAL'
       AND scope_key = 'global'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
  `).bind(now).first<{ count: number | string | null }>()

  return Number(row?.count ?? 0) > 0
}
