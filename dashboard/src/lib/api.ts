import { Code, ConnectError, createClient, type Client, type Interceptor, type Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AdminService } from "@/gen/admin_pb";
import { AuthService } from "@/gen/auth_pb";
import { Role as ProtoRole } from "@/gen/common_pb";
import { EventStreamService } from "@/gen/events_pb";
import { SystemService } from "@/gen/system_pb";
import { browserLock, SessionExpired, SessionManager, type KeyValueStore, type Role } from "@/lib/auth/session";

const PUBLIC_METHODS = new Set(["AdminLogin", "RefreshToken", "HealthCheck", "GetVersion", "GetPublicConfig"]);

export const ROLE_FROM_PROTO: Partial<Record<ProtoRole, Role>> = {
  [ProtoRole.SUPER_ADMIN]: "super_admin",
  [ProtoRole.ADMIN]: "admin",
  [ProtoRole.FL_ENGINEER]: "fl_engineer",
  [ProtoRole.VIEWER]: "viewer",
};

export function isSessionExpired(err: unknown): boolean {
  if (err instanceof SessionExpired) return true;
  return err instanceof ConnectError && err.cause instanceof SessionExpired;
}

export function isAuthFailure(err: unknown): boolean {
  const code = ConnectError.from(err).code;
  return code === Code.Unauthenticated || code === Code.PermissionDenied || code === Code.InvalidArgument;
}

export function describeError(err: unknown): string {
  const e = ConnectError.from(err);
  if (e.code === Code.Unavailable || (e.code === Code.Unknown && /fetch|network/i.test(e.rawMessage))) {
    return "The Federix server can't be reached. Check that it is running.";
  }
  if (e.code === Code.ResourceExhausted) return e.rawMessage || "Too many attempts. Wait a moment and try again.";
  return e.rawMessage || "Something went wrong.";
}

function authInterceptor(session: SessionManager): Interceptor {
  return (next) => async (req) => {
    if (PUBLIC_METHODS.has(req.method.name)) return next(req);
    const token = await session.accessToken();
    req.header.set("authorization", `Bearer ${token}`);
    try {
      return await next(req);
    } catch (err) {
      if (req.stream || ConnectError.from(err).code !== Code.Unauthenticated) throw err;
      const fresh = await session.refreshNow(token);
      req.header.set("authorization", `Bearer ${fresh}`);
      return next(req);
    }
  };
}

export interface Api {
  auth: Client<typeof AuthService>;
  admin: Client<typeof AdminService>;
  system: Client<typeof SystemService>;
  events: Client<typeof EventStreamService>;
  session: SessionManager;
}

export function browserStore(): KeyValueStore {
  return {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => window.localStorage.setItem(key, value),
    remove: (key) => window.localStorage.removeItem(key),
  };
}

export function createApi(apiUrl: string, store: KeyValueStore = browserStore()): Api {
  const plain: Transport = createConnectTransport({ baseUrl: apiUrl, useBinaryFormat: true });
  const refreshClient = createClient(AuthService, plain);
  const session = new SessionManager({
    store,
    lock: browserLock(),
    isAuthFailure,
    refresh: async (refreshToken) => {
      const res = await refreshClient.refreshToken({ refreshToken });
      return { accessToken: res.accessToken, refreshToken: res.refreshToken, expiresIn: res.expiresIn };
    },
  });
  const transport = createConnectTransport({
    baseUrl: apiUrl,
    useBinaryFormat: true,
    interceptors: [authInterceptor(session)],
  });
  return {
    auth: createClient(AuthService, transport),
    admin: createClient(AdminService, transport),
    system: createClient(SystemService, transport),
    events: createClient(EventStreamService, transport),
    session,
  };
}
