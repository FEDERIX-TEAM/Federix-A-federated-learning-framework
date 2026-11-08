export interface RuntimeConfig {
  apiUrl: string;
  healthPollMs: number;
}

export class RuntimeConfigError extends Error {}

function int(name: string, raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new RuntimeConfigError(`${name} must be a whole number >= ${min} (got ${JSON.stringify(raw)})`);
  }
  return value;
}

function httpUrl(name: string, raw: string | undefined, fallback: string): string {
  const text = (raw === undefined || raw.trim() === "" ? fallback : raw.trim()).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new RuntimeConfigError(`${name} must be an http(s) URL (got ${JSON.stringify(raw)})`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RuntimeConfigError(`${name} must be an http(s) URL (got ${JSON.stringify(raw)})`);
  }
  return text;
}

export function readRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const problems: string[] = [];
  const attempt = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (err) {
      problems.push((err as Error).message);
      return fallback;
    }
  };
  const apiUrl = attempt(() => httpUrl("FEDERIX_API_URL", env.FEDERIX_API_URL, "http://127.0.0.1:4000"), "");
  const healthPollMs = attempt(() => int("FEDERIX_HEALTH_POLL_MS", env.FEDERIX_HEALTH_POLL_MS, 10000, 1000), 10000);
  if (problems.length) throw new RuntimeConfigError(`Invalid dashboard configuration:\n  - ${problems.join("\n  - ")}`);
  return { apiUrl, healthPollMs };
}
