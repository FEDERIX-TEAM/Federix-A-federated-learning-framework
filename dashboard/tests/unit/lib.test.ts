import { describe, expect, it } from "vitest";
import { readRuntimeConfig, RuntimeConfigError } from "@/lib/runtime";
import { canAccess, itemFor, NAV, navFor } from "@/lib/nav";
import { initials, matches, safeNext } from "@/lib/text";

describe("readRuntimeConfig", () => {
  it("uses defaults and trims a trailing slash", () => {
    expect(readRuntimeConfig({})).toEqual({ apiUrl: "http://127.0.0.1:4000", healthPollMs: 10000 });
    expect(readRuntimeConfig({ FEDERIX_API_URL: "https://fl.example.com/", FEDERIX_HEALTH_POLL_MS: "2500" })).toEqual({
      apiUrl: "https://fl.example.com",
      healthPollMs: 2500,
    });
  });

  it("lists every problem at once", () => {
    let error: unknown;
    try {
      readRuntimeConfig({ FEDERIX_API_URL: "ftp://x", FEDERIX_HEALTH_POLL_MS: "fast" });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(RuntimeConfigError);
    expect(String((error as Error).message)).toContain("FEDERIX_API_URL must be an http(s) URL");
    expect(String((error as Error).message)).toContain("FEDERIX_HEALTH_POLL_MS must be a whole number >= 1000");
  });
});

describe("navigation rules", () => {
  it("matches each page to its nav item", () => {
    expect(itemFor("/")?.label).toBe("Overview");
    expect(itemFor("/rounds/abc")?.label).toBe("Rounds");
    expect(itemFor("/nowhere")).toBeUndefined();
  });

  it("follows the backend's RBAC rules for each role", () => {
    expect(navFor("super_admin")).toHaveLength(NAV.length);
    expect(navFor("viewer").map((i) => i.href)).toEqual(["/", "/metrics", "/rounds", "/models", "/config"]);
    expect(canAccess("viewer", "/users")).toBe(false);
    expect(canAccess("admin", "/users")).toBe(false);
    expect(canAccess("admin", "/clients")).toBe(true);
    expect(canAccess("fl_engineer", "/logs")).toBe(false);
  });
});

describe("text helpers", () => {
  it("only follows same-site paths after sign-in", () => {
    expect(safeNext("/rounds")).toBe("/rounds");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/login?next=/x")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });

  it("matches every word of a query", () => {
    expect(matches("Rounds training aggregation", "train agg")).toBe(true);
    expect(matches("Rounds training aggregation", "train users")).toBe(false);
    expect(matches("anything", "  ")).toBe(true);
  });

  it("builds initials from names and emails", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("grace.hopper")).toBe("GH");
    expect(initials("x")).toBe("X");
    expect(initials("")).toBe("?");
  });
});

describe("isSessionExpired", async () => {
  const { isSessionExpired } = await import("@/lib/api");
  const { SessionExpired } = await import("@/lib/auth/session");
  const { ConnectError, Code } = await import("@connectrpc/connect");

  it("recognises SessionExpired even when Connect wraps it", () => {
    const raw = new SessionExpired();
    expect(isSessionExpired(raw)).toBe(true);
    expect(isSessionExpired(ConnectError.from(raw))).toBe(true);
    expect(isSessionExpired(new ConnectError("nope", Code.Unavailable))).toBe(false);
    expect(isSessionExpired(new Error("x"))).toBe(false);
  });
});
