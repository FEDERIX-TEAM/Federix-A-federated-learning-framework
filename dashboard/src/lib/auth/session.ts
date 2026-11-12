export const ROLES = ["super_admin", "admin", "fl_engineer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface StoredSession {
  userId: string;
  email: string;
  role: Role;
  accessToken: string;
  refreshToken: string;
  accessIssuedAt: number;
  accessExpiresAt: number;
}

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export type LockFn = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type RefreshFn = (refreshToken: string) => Promise<RefreshedTokens>;

export class SessionExpired extends Error {
  constructor(message = "Your session has ended. Sign in again.") {
    super(message);
    this.name = "SessionExpired";
  }
}

export const SESSION_KEY = "federix.session";
export const REFRESH_LOCK = "federix.refresh";
const MAX_MARGIN_MS = 30_000;

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return JSON.parse(atob(base64));
}

export function tokenTimes(token: string): { issuedAt: number; expiresAt: number } | null {
  try {
    const payload = decodeSegment(token.split(".")[1] ?? "") as { iat?: unknown; exp?: unknown };
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
    return { issuedAt: payload.iat * 1000, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

function isSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    typeof v.email === "string" &&
    typeof v.role === "string" &&
    (ROLES as readonly string[]).includes(v.role) &&
    typeof v.accessToken === "string" &&
    typeof v.refreshToken === "string" &&
    typeof v.accessIssuedAt === "number" &&
    typeof v.accessExpiresAt === "number"
  );
}

export const inTabLock: LockFn = (_name, fn) => fn();

export function browserLock(): LockFn {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return (name, fn) => navigator.locks.request(name, fn) as Promise<Awaited<ReturnType<typeof fn>>>;
  }
  return inTabLock;
}

export interface SessionManagerOptions {
  store: KeyValueStore;
  refresh: RefreshFn;
  isAuthFailure: (err: unknown) => boolean;
  lock?: LockFn;
  now?: () => number;
}

export class SessionManager {
  private readonly store: KeyValueStore;
  private readonly refreshTokens: RefreshFn;
  private readonly isAuthFailure: (err: unknown) => boolean;
  private readonly lock: LockFn;
  private readonly now: () => number;
  private inflight: Promise<string> | null = null;
  private listeners = new Set<(session: StoredSession | null) => void>();
  refreshCount = 0;

  constructor(options: SessionManagerOptions) {
    this.store = options.store;
    this.refreshTokens = options.refresh;
    this.isAuthFailure = options.isAuthFailure;
    this.lock = options.lock ?? inTabLock;
    this.now = options.now ?? Date.now;
  }

  current(): StoredSession | null {
    const raw = this.store.get(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isSession(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  start(input: { userId: string; email: string; role: Role; accessToken: string; refreshToken: string }): StoredSession {
    const times = tokenTimes(input.accessToken);
    const now = this.now();
    const session: StoredSession = {
      ...input,
      accessIssuedAt: times?.issuedAt ?? now,
      accessExpiresAt: times?.expiresAt ?? now + 60_000,
    };
    this.write(session);
    return session;
  }

  clear(): void {
    this.store.remove(SESSION_KEY);
    this.emit(null);
  }

  subscribe(listener: (session: StoredSession | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  externalChange(): void {
    this.emit(this.current());
  }

  isFresh(session: StoredSession): boolean {
    const lifetime = Math.max(0, session.accessExpiresAt - session.accessIssuedAt);
    const margin = Math.min(MAX_MARGIN_MS, lifetime * 0.2);
    return session.accessExpiresAt - margin > this.now();
  }

  async accessToken(): Promise<string> {
    const session = this.current();
    if (!session) throw new SessionExpired();
    if (this.isFresh(session)) return session.accessToken;
    return this.refreshNow(session.accessToken);
  }

  refreshNow(rejectedToken?: string): Promise<string> {
    if (!this.inflight) {
      this.inflight = this.lock(REFRESH_LOCK, () => this.rotate(rejectedToken)).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async rotate(rejectedToken?: string): Promise<string> {
    const session = this.current();
    if (!session) throw new SessionExpired();
    if (rejectedToken !== undefined && session.accessToken !== rejectedToken && this.isFresh(session)) {
      return session.accessToken;
    }
    let tokens: RefreshedTokens;
    try {
      tokens = await this.refreshTokens(session.refreshToken);
    } catch (err) {
      if (this.isAuthFailure(err)) {
        this.clear();
        throw new SessionExpired();
      }
      throw err;
    }
    this.refreshCount += 1;
    const times = tokenTimes(tokens.accessToken);
    const now = this.now();
    const next: StoredSession = {
      ...session,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || session.refreshToken,
      accessIssuedAt: times?.issuedAt ?? now,
      accessExpiresAt: times?.expiresAt ?? now + Math.max(1, tokens.expiresIn) * 1000,
    };
    this.write(next);
    return next.accessToken;
  }

  private write(session: StoredSession): void {
    this.store.set(SESSION_KEY, JSON.stringify(session));
    this.emit(session);
  }

  private emit(session: StoredSession | null): void {
    for (const listener of this.listeners) listener(session);
  }
}
