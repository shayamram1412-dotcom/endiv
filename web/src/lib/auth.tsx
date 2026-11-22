import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setUnauthenticatedHandler } from './api.ts';
import { can, hasRole, isSupervisor, levelFor, type Level, type Module, type Role } from '@shared/permissions.ts';
import { VENUE_CODES, VENUE_RULES, type VenueCode } from '@shared/domain.ts';
import { seesMargins } from '@shared/costing.ts';
import type { Me, UserRef } from '@shared/types.ts';

interface AuthCtx {
  me: Me;
  can: (m: Module, level?: Level, venue?: VenueCode | null) => boolean;
  level: (m: Module, venue?: VenueCode | null) => Level;
  hasRole: (r: Role, venue?: VenueCode | null) => boolean;
  supervisor: boolean;
  /** Sees costs and profit (management and the accountant). */
  margins: boolean;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
}

export function AuthGate({ children, login }: { children: ReactNode; login: ReactNode }) {
  const qc = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const meQ = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), retry: false, staleTime: Infinity });

  /** Drop the signed-in user and every cached record, so the login screen shows and nothing of the previous user remains. */
  const signOutLocally = useCallback(() => {
    void qc.cancelQueries();
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    setSignedOut(true);
  }, [qc]);

  useEffect(() => {
    setUnauthenticatedHandler(signOutLocally);
  }, [signOutLocally]);

  // A new successful sign-in brings a user back into the cache.
  useEffect(() => {
    if (meQ.data) setSignedOut(false);
  }, [meQ.data]);

  const value = useMemo<AuthCtx | null>(() => {
    const me = meQ.data;
    if (!me || signedOut) return null;
    return {
      me,
      can: (m, l = 1, v) => can(me, m, l, v),
      level: (m, v) => levelFor(me, m, v),
      hasRole: (r, v) => hasRole(me, r, v),
      supervisor: isSupervisor(me),
      margins: seesMargins(me),
      logout: async () => {
        try {
          await api.post('/auth/logout');
        } finally {
          // Even if the server is unreachable, the screen must not stay signed in.
          signOutLocally();
        }
      },
    };
  }, [meQ.data, signedOut, signOutLocally]);

  if (meQ.isLoading && !signedOut) {
    return <div className="grid min-h-dvh place-items-center text-[var(--color-muted)]" role="status">טוען…</div>;
  }
  if (!value) return <>{login}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export interface DirectoryUser extends UserRef {
  grants: { role: Role; venue: VenueCode | null }[];
}

/** All active users with their roles — for assignment pickers. */
export function useDirectory() {
  return useQuery({ queryKey: ['directory'], queryFn: () => api.get<DirectoryUser[]>('/users/directory'), staleTime: 5 * 60_000 });
}

export function usersWithRole(users: DirectoryUser[] | undefined, role: Role, venue?: VenueCode | null): DirectoryUser[] {
  return (users ?? []).filter((u) => u.grants.some((g) => (g.role === role || g.role === 'owner') && (!venue || !g.venue || g.venue === venue)))
    .sort((a, b) => Number(b.grants.some((g) => g.role === role)) - Number(a.grants.some((g) => g.role === role)));
}

/** Can this user hand over events from a hall-sold venue (any venue whose track is "hall")? */
export function canHallIntake(auth: { can: (m: Module, level?: Level, venue?: VenueCode | null) => boolean }): boolean {
  return VENUE_CODES.some((v) => VENUE_RULES[v]?.track === 'hall' && auth.can('events', 2, v));
}
