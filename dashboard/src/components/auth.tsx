"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createApi, isAuthFailure, isSessionExpired, ROLE_FROM_PROTO, type Api } from "@/lib/api";
import { SESSION_KEY, SessionExpired, type Role, type StoredSession } from "@/lib/auth/session";
import { useRuntime } from "@/components/runtime";

export type AuthStatus = "loading" | "signed-in" | "signed-out";

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: Role;
  lastLogin: string;
}

interface AuthContextValue {
  api: Api;
  status: AuthStatus;
  profile: Profile | null;
  endedUnexpectedly: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export class LoginRefused extends Error {}

function profileFrom(session: StoredSession, me?: { id: string; name: string; lastLogin: string }): Profile {
  return {
    id: me?.id || session.userId,
    name: me?.name || session.email.split("@")[0] || session.email,
    email: session.email,
    role: session.role,
    lastLogin: me?.lastLogin ?? "",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { apiUrl } = useRuntime();
  const queryClient = useQueryClient();
  const api = useMemo(() => createApi(apiUrl), [apiUrl]);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [endedUnexpectedly, setEndedUnexpectedly] = useState(false);
  const leaving = useRef(false);

  const loadProfile = useCallback(
    async (session: StoredSession) => {
      let me: { id: string; name: string; lastLogin: string } | undefined;
      try {
        me = await api.auth.getMe({});
      } catch (err) {
        if (isSessionExpired(err) || isAuthFailure(err)) throw err;
      }
      if (!api.session.current()) throw new SessionExpired();
      setProfile(profileFrom(session, me));
    },
    [api],
  );

  useEffect(() => {
    const unsubscribe = api.session.subscribe((session) => {
      if (session) return;
      setProfile(null);
      setStatus("signed-out");
      setEndedUnexpectedly(!leaving.current);
      leaving.current = false;
      queryClient.clear();
    });
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY || e.key === null) api.session.externalChange();
    };
    window.addEventListener("storage", onStorage);

    const existing = api.session.current();
    if (!existing) {
      setStatus("signed-out");
    } else {
      loadProfile(existing)
        .then(() => setStatus("signed-in"))
        .catch(() => {
          leaving.current = false;
          api.session.clear();
        });
    }
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, [api, loadProfile, queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.auth.adminLogin({ email: email.trim(), password });
      const role = ROLE_FROM_PROTO[res.role];
      if (!role) throw new LoginRefused("This account can't use the dashboard.");
      const session = api.session.start({
        userId: res.userId,
        email: email.trim().toLowerCase(),
        role,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      setEndedUnexpectedly(false);
      await loadProfile(session);
      setStatus("signed-in");
    },
    [api, loadProfile],
  );

  const logout = useCallback(async () => {
    leaving.current = true;
    if (api.session.current()) {
      try {
        await api.auth.logout({});
      } catch {}
    }
    api.session.clear();
  }, [api]);

  const value = useMemo(
    () => ({ api, status, profile, endedUnexpectedly, login, logout }),
    [api, status, profile, endedUnexpectedly, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function useApi(): Api {
  return useAuth().api;
}
