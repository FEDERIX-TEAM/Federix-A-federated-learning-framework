"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/components/auth";
import { useRuntime } from "@/components/runtime";

export type Overall = "checking" | "healthy" | "degraded" | "offline";

export interface ServiceState {
  key: "api" | "db" | "redis" | "fl";
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}

export function useHealth() {
  const api = useApi();
  const { healthPollMs } = useRuntime();
  const query = useQuery({
    queryKey: ["system", "health"],
    queryFn: () => api.system.healthCheck({}),
    refetchInterval: healthPollMs,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });

  const h = query.data;
  let overall: Overall = "checking";
  if (query.isError) overall = "offline";
  else if (h) overall = h.status === "ok" ? "healthy" : "degraded";

  const services: ServiceState[] = [
    { key: "api", label: "API server", value: query.isError ? "unreachable" : h ? "online" : "checking", tone: query.isError ? "bad" : h ? "ok" : "neutral" },
    { key: "db", label: "MongoDB", value: h?.db ?? "—", tone: !h ? "neutral" : h.db === "connected" ? "ok" : "bad" },
    { key: "redis", label: "Redis", value: h?.redis ?? "—", tone: !h ? "neutral" : h.redis === "connected" ? "ok" : "bad" },
    { key: "fl", label: "FL server", value: h?.flServer ?? "—", tone: !h ? "neutral" : h.flServer === "online" ? "ok" : h.flServer === "offline" ? "warn" : "neutral" },
  ];
  return { ...query, overall, services, uptimeMs: h ? Number(h.uptimeMs) : null };
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}
