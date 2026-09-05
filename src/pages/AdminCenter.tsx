import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useManagementAccess } from '@/hooks/useManagementAccess';
import {
  managementApi,
  type ManagementProfile,
  type ManagementRole,
  type ManagementRoleGrant,
  type ManagementSummary,
  type UserStatus,
} from '@/lib/managementApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const ADMIN_LINKS = [
  ['/admin', 'Overview'],
  ['/admin/users', 'Users'],
  ['/admin/access', 'Access'],
  ['/admin/sessions', 'Sessions'],
  ['/admin/usage', 'Usage'],
  ['/admin/audit', 'Audit'],
  ['/admin/system', 'System'],
] as const;

const ROLES: ManagementRole[] = [
  'VIEWER',
  'TRADER',
  'RISK_OPERATOR',
  'RISK_ADMIN',
  'WITHDRAWAL_REQUESTER',
  'WITHDRAWAL_APPROVER',
  'AUDITOR',
  'RELEASE_ADMIN',
];

function valueText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function RecordTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const keys = useMemo(() => {
    const set = new Set<string>();
    rows.slice(0, 25).forEach((row) => Object.keys(row).forEach((key) => set.add(key)));
    return Array.from(set).slice(0, 10);
  }, [rows]);

  if (!rows.length) return <p className="text-sm text-muted-foreground">No records reported.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-muted/40">
          <tr>{keys.map((key) => <th key={key} className="px-3 py-2 font-semibold">{key}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${valueText(row[keys[0]])}`} className="border-t">
              {keys.map((key) => <td key={key} className="max-w-xs break-all px-3 py-2 font-mono">{valueText(row[key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminCenter() {
  const { pathname } = useLocation();
  const { session } = useAuth();
  const access = useManagementAccess();
  const token = session?.access_token ?? '';
  const section = pathname.split('/')[2] || 'overview';

  const [summary, setSummary] = useState<ManagementSummary | null>(null);
  const [users, setUsers] = useState<ManagementProfile[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ManagementProfile | null>(null);
  const [roles, setRoles] = useState<ManagementRoleGrant[]>([]);
  const [roleToGrant, setRoleToGrant] = useState<ManagementRole>('VIEWER');
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [usage, setUsage] = useState<{ by_category: Array<Record<string, unknown>>; by_day: Array<Record<string, unknown>> } | null>(null);
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [system, setSystem] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async (query = search) => {
    if (!token) return;
    const result = await managementApi.users(token, query);
    setUsers(result.users);
  }, [search, token]);

  const loadSelected = useCallback(async (actorId: string) => {
    if (!token) return;
    const result = await managementApi.user(token, actorId);
    setSelected(result.profile);
    setRoles(result.roles);
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token || !access.canReadAdmin) return;
    setBusy(true);
    setError(null);
    try {
      if (section === 'overview') setSummary(await managementApi.summary(token));
      if (section === 'users' || section === 'access') await loadUsers();
      if (section === 'sessions') setSessions((await managementApi.sessions(token)).events);
      if (section === 'usage') {
        const result = await managementApi.usage(token, 30);
        setUsage({ by_category: result.by_category, by_day: result.by_day });
      }
      if (section === 'audit') setAudit((await managementApi.audit(token)).events);
      if (section === 'system') setSystem(await managementApi.system(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load administrative data.');
    } finally {
      setBusy(false);
    }
  }, [access.canReadAdmin, loadUsers, section, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeStatus = async (status: UserStatus) => {
    if (!token || !selected) return;
    const reason = status === 'SUSPENDED' ? 'Administrative suspension from usage-management console' : undefined;
    setBusy(true);
    try {
      await managementApi.updateUser(token, selected.actor_id, { status, reason });
      toast.success(`User status changed to ${status}.`);
      await loadSelected(selected.actor_id);
      await loadUsers();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'User update failed.');
    } finally {
      setBusy(false);
    }
  };

  const grantRole = async () => {
    if (!token || !selected) return;
    setBusy(true);
    try {
      await managementApi.grantRole(token, selected.actor_id, {
        role: roleToGrant,
        scope_type: 'GLOBAL',
        scope_key: 'global',
      });
      toast.success(`${roleToGrant} granted.`);
      await loadSelected(selected.actor_id);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Role grant failed.');
    } finally {
      setBusy(false);
    }
  };

  const revokeRole = async (role: ManagementRoleGrant) => {
    if (!token || !selected) return;
    setBusy(true);
    try {
      await managementApi.revokeRole(token, selected.actor_id, {
        role: role.role,
        scope_type: role.scope_type,
        scope_key: role.scope_key,
      });
      toast.success(`${role.role} revoked.`);
      await loadSelected(selected.actor_id);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Role revocation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Usage management</p>
            <h1 className="mt-1 text-3xl font-bold">Administrative control plane</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Real user lifecycle, scoped access, usage evidence and immutable management auditing. This console cannot enable live trading, mainnet, withdrawals or provider mutation.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</Button>
            <Button asChild variant="outline"><Link to="/account">Account</Link></Button>
            <Button asChild variant="outline"><Link to="/status">Status</Link></Button>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2 rounded-xl border bg-card p-3">
          {ADMIN_LINKS.map(([href, label]) => (
            <Link
              key={href}
              to={href}
              className={`rounded-md px-3 py-2 text-sm font-semibold ${pathname === href ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {error && <Card className="border-destructive"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}

        {section === 'overview' && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              ['Users', summary?.users_total],
              ['Active users', summary?.users_active],
              ['Suspended', summary?.users_suspended],
              ['Active role grants', summary?.active_role_grants],
              ['Audit events · 24h', summary?.audit_events_24h],
              ['Usage requests · today', summary?.usage_requests_today],
            ].map(([label, value]) => (
              <Card key={label as string}><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-bold">{value ?? '—'}</p></CardContent></Card>
            ))}
            <Card className="md:col-span-2 xl:col-span-3">
              <CardHeader><CardTitle>Permanent release locks</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <div>Mode: <strong>{summary?.trading_mode ?? 'paper'}</strong></div>
                <div>Network: <strong>{summary?.network ?? 'testnet'}</strong></div>
                <div>Mainnet: <strong>{String(summary?.allow_mainnet ?? false)}</strong></div>
                <div>Live: <strong>{String(summary?.live_trading_enabled ?? false)}</strong></div>
                <div>Withdrawals: <strong>{String(summary?.withdrawals_enabled ?? false)}</strong></div>
                <div>Mutation: <strong>{String(summary?.provider_mutation_enabled ?? false)}</strong></div>
              </CardContent>
            </Card>
          </div>
        )}

        {(section === 'users' || section === 'access') && (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader><CardTitle>User directory</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email, name or actor ID" />
                  <Button variant="outline" onClick={() => void loadUsers(search)}>Search</Button>
                </div>
                <div className="space-y-2">
                  {users.map((user) => (
                    <button
                      type="button"
                      key={user.actor_id}
                      onClick={() => void loadSelected(user.actor_id)}
                      className="w-full rounded-lg border p-3 text-left hover:bg-muted/40"
                    >
                      <div className="flex justify-between gap-3"><strong>{user.display_name || user.email || user.actor_id}</strong><span className="text-xs">{user.status}</span></div>
                      <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{user.actor_id}</div>
                    </button>
                  ))}
                  {!users.length && <p className="text-sm text-muted-foreground">No users found.</p>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{section === 'access' ? 'Scoped access' : 'User management'}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {!selected && <p className="text-sm text-muted-foreground">Select a user.</p>}
                {selected && (
                  <>
                    <div className="space-y-1 text-sm">
                      <p><strong>{selected.display_name || selected.email || selected.actor_id}</strong></p>
                      <p>Status: {selected.status}</p>
                      <p className="break-all font-mono text-xs">{selected.actor_id}</p>
                    </div>
                    {access.canManageUsers && section === 'users' && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => void changeStatus('ACTIVE')}>Activate</Button>
                        <Button size="sm" variant="outline" onClick={() => void changeStatus('SUSPENDED')}>Suspend</Button>
                        <Button size="sm" variant="outline" onClick={() => void changeStatus('DISABLED')}>Disable</Button>
                      </div>
                    )}
                    <div>
                      <p className="mb-2 text-sm font-semibold">Active grants</p>
                      <div className="space-y-2">
                        {roles.map((role) => (
                          <div key={`${role.role}:${role.scope_type}:${role.scope_key}`} className="flex items-center justify-between gap-3 rounded-md border p-2 text-xs">
                            <span>{role.role} · {role.scope_type}:{role.scope_key}</span>
                            {access.canManageAccess && <Button size="sm" variant="outline" onClick={() => void revokeRole(role)}>Revoke</Button>}
                          </div>
                        ))}
                        {!roles.length && <p className="text-xs text-muted-foreground">No active role grants.</p>}
                      </div>
                    </div>
                    {access.canManageAccess && (
                      <div className="flex gap-2">
                        <select className="h-10 flex-1 rounded-md border bg-background px-3 text-sm" value={roleToGrant} onChange={(event) => setRoleToGrant(event.target.value as ManagementRole)}>
                          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>
                        <Button onClick={() => void grantRole()} disabled={busy}>Grant global</Button>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Role grants are server-authoritative and do not override paper/testnet safety locks.</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {section === 'sessions' && (
          <Card><CardHeader><CardTitle>Session security events</CardTitle></CardHeader><CardContent><RecordTable rows={sessions} /><p className="mt-3 text-xs text-muted-foreground">Session issuance and global revocation remain authoritative at the configured identity provider.</p></CardContent></Card>
        )}

        {section === 'usage' && (
          <div className="space-y-6">
            <Card><CardHeader><CardTitle>Usage by category · 30 days</CardTitle></CardHeader><CardContent><RecordTable rows={usage?.by_category ?? []} /></CardContent></Card>
            <Card><CardHeader><CardTitle>Usage by day</CardTitle></CardHeader><CardContent><RecordTable rows={usage?.by_day ?? []} /></CardContent></Card>
          </div>
        )}

        {section === 'audit' && (
          <Card><CardHeader><CardTitle>Immutable management audit</CardTitle></CardHeader><CardContent><RecordTable rows={audit} /></CardContent></Card>
        )}

        {section === 'system' && (
          <Card>
            <CardHeader><CardTitle>System & safety contract</CardTitle></CardHeader>
            <CardContent>
              {system ? <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-4 text-xs">{JSON.stringify(system, null, 2)}</pre> : <p className="text-sm text-muted-foreground">No system evidence loaded.</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
