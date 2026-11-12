import { describe, expect, it, vi } from "vitest";
import { SESSION_KEY, SessionExpired, SessionManager, tokenTimes, type KeyValueStore, type LockFn } from "@/lib/auth/session";

function jwt(iat: number, exp: number, extra: Record<string, unknown> = {}): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ iat, exp, ...extra })}.sig`;
}

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

function serialLock(): LockFn {
  let tail: Promise<unknown> = Promise.resolve();
  return (_name, fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

const authError = Object.assign(new Error("unauthenticated"), { auth: true });

function setup(nowSec = 1_000, opts: { store?: KeyValueStore; lock?: LockFn } = {}) {
  let now = nowSec * 1000;
  const store = opts.store ?? memoryStore();
  let issued = 0;
  const refresh = vi.fn(async (token: string) => {
    if (token === "revoked") throw authError;
    issued += 1;
    const t = Math.floor(now / 1000);
    return { accessToken: jwt(t, t + 100, { n: issued }), refreshToken: `refresh-${issued}`, expiresIn: 100 };
  });
  const manager = new SessionManager({
    store,
    refresh,
    lock: opts.lock ?? serialLock(),
    isAuthFailure: (e) => (e as { auth?: boolean }).auth === true,
    now: () => now,
  });
  return { manager, store, refresh, advance: (s: number) => (now += s * 1000), nowSec: () => Math.floor(now / 1000) };
}

function begin(manager: SessionManager, iat: number, exp: number, refreshToken = "refresh-0") {
  return manager.start({ userId: "u1", email: "a@x.io", role: "admin", accessToken: jwt(iat, exp), refreshToken });
}

describe("tokenTimes", () => {
  it("reads iat and exp from a JWT and rejects anything else", () => {
    expect(tokenTimes(jwt(10, 70))).toEqual({ issuedAt: 10_000, expiresAt: 70_000 });
    expect(tokenTimes("not-a-jwt")).toBeNull();
    expect(tokenTimes(jwt(10, 70).replace(/\..*\./, ".e30."))).toBeNull();
  });
});

describe("SessionManager", () => {
  it("returns the stored access token while it is fresh", async () => {
    const { manager, refresh } = setup();
    const s = begin(manager, 1_000, 1_100);
    expect(await manager.accessToken()).toBe(s.accessToken);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes inside the safety margin and stores the rotated refresh token", async () => {
    const { manager, refresh, advance, store } = setup();
    begin(manager, 1_000, 1_100);
    advance(85);
    const token = await manager.accessToken();
    expect(refresh).toHaveBeenCalledWith("refresh-0");
    expect(token).not.toBe(jwt(1_000, 1_100));
    expect(JSON.parse(store.get(SESSION_KEY)!).refreshToken).toBe("refresh-1");
  });

  it("caps the margin at 30 seconds for long-lived tokens", async () => {
    const { manager, refresh, advance } = setup();
    begin(manager, 1_000, 1_000 + 900);
    advance(900 - 31);
    await manager.accessToken();
    expect(refresh).not.toHaveBeenCalled();
    advance(2);
    await manager.accessToken();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("runs one refresh for many concurrent callers", async () => {
    const { manager, refresh, advance } = setup();
    begin(manager, 1_000, 1_100);
    advance(200);
    const tokens = await Promise.all(Array.from({ length: 8 }, () => manager.accessToken()));
    expect(new Set(tokens).size).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("adopts a token another tab already rotated instead of reusing the old refresh token", async () => {
    const store = memoryStore();
    const lock = serialLock();
    const tabA = setup(1_000, { store, lock });
    const tabB = setup(1_000, { store, lock });
    begin(tabA.manager, 1_000, 1_100);
    tabA.advance(200);
    tabB.advance(200);
    const stale = tabB.manager.current()!.accessToken;
    const fromA = await tabA.manager.accessToken();
    const fromB = await tabB.manager.refreshNow(stale);
    expect(fromB).toBe(fromA);
    expect(tabA.refresh).toHaveBeenCalledTimes(1);
    expect(tabB.refresh).not.toHaveBeenCalled();
  });

  it("forces a refresh when the server rejects a token that still looks fresh", async () => {
    const { manager, refresh } = setup();
    const s = begin(manager, 1_000, 1_100);
    const fresh = await manager.refreshNow(s.accessToken);
    expect(fresh).not.toBe(s.accessToken);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clears the session and raises SessionExpired when the refresh token is refused", async () => {
    const { manager, advance, store } = setup();
    const seen: unknown[] = [];
    manager.subscribe((s) => seen.push(s));
    begin(manager, 1_000, 1_100, "revoked");
    advance(200);
    await expect(manager.accessToken()).rejects.toBeInstanceOf(SessionExpired);
    expect(store.get(SESSION_KEY)).toBeNull();
    expect(seen.at(-1)).toBeNull();
  });

  it("keeps the session when the refresh fails for a network reason", async () => {
    const { manager, refresh, advance, store } = setup();
    begin(manager, 1_000, 1_100);
    advance(200);
    refresh.mockRejectedValueOnce(new Error("offline"));
    await expect(manager.accessToken()).rejects.toThrow("offline");
    expect(store.get(SESSION_KEY)).not.toBeNull();
    await expect(manager.accessToken()).resolves.toBeTypeOf("string");
  });

  it("treats a missing or corrupted session as signed out", async () => {
    const { manager, store } = setup();
    await expect(manager.accessToken()).rejects.toBeInstanceOf(SessionExpired);
    store.set(SESSION_KEY, "{not json");
    expect(manager.current()).toBeNull();
    store.set(SESSION_KEY, JSON.stringify({ userId: "u", role: "sdk_client" }));
    expect(manager.current()).toBeNull();
  });
});
