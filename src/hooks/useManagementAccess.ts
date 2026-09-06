import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  managementApi,
  ManagementApiError,
  type ManagementMe,
  type ManagementPermissions,
} from '@/lib/managementApi';

const EMPTY_PERMISSIONS: ManagementPermissions = {
  canReadAdmin: false,
  canManageUsers: false,
  canManageAccess: false,
  canViewAudit: false,
  canViewUsage: false,
  canManageSystem: false,
};

export function useManagementAccess() {
  const { user, session, isDemoMode } = useAuth();
  const [data, setData] = useState<ManagementMe | null>(null);
  const [loading, setLoading] = useState(Boolean(user && !isDemoMode));
  const [error, setError] = useState<ManagementApiError | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (isDemoMode) {
      setData({
        profile: {
          actor_id: user.id,
          email: user.email ?? null,
          display_name: 'Certification demo user',
          status: 'ACTIVE',
          account_type: 'DEMO',
          onboarding_state: 'COMPLETE',
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
          last_login_at: null,
          suspended_at: null,
          suspended_reason: null,
        },
        roles: [{
          role: 'VIEWER',
          scope_type: 'GLOBAL',
          scope_key: 'global',
          granted_by: 'DEMO_RUNTIME',
          granted_at: new Date(0).toISOString(),
          expires_at: null,
        }],
        permissions: EMPTY_PERMISSIONS,
        access_allowed: true,
        certification_mode: true,
        request_id: 'demo-local',
      });
      setError(null);
      setLoading(false);
      return;
    }
    if (!session?.access_token) {
      setData(null);
      setError(new ManagementApiError(401, 'UNAUTHENTICATED', 'A valid session is required.'));
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const next = await managementApi.me(session.access_token);
      setData(next);
      setError(null);
    } catch (cause) {
      setData(null);
      setError(cause instanceof ManagementApiError
        ? cause
        : new ManagementApiError(503, 'BACKEND_UNAVAILABLE', 'Account authorization is unavailable.'));
    } finally {
      setLoading(false);
    }
  }, [isDemoMode, session?.access_token, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const roles = useMemo(() => new Set(data?.roles.map((role) => role.role) ?? []), [data]);

  return {
    data,
    loading,
    error,
    refresh,
    roles,
    isActive: data?.profile.status === 'ACTIVE' && data.access_allowed,
    canReadAdmin: Boolean(data?.permissions.canReadAdmin),
    canManageUsers: Boolean(data?.permissions.canManageUsers),
    canManageAccess: Boolean(data?.permissions.canManageAccess),
    canViewAudit: Boolean(data?.permissions.canViewAudit),
    canViewUsage: Boolean(data?.permissions.canViewUsage),
    canManageSystem: Boolean(data?.permissions.canManageSystem),
  };
}
