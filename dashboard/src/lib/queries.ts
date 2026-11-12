"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/components/auth";
import { FlServerState, RoundStatus } from "@/gen/common_pb";
import type { Tone } from "@/components/ui";

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of stream) out.push(item);
  return out;
}

export function useOverview() {
  const api = useApi();
  return useQuery({ queryKey: ["overview"], queryFn: () => api.admin.getOverview({}), refetchInterval: 30_000 });
}

export function useConvergence(lastN = 30) {
  const api = useApi();
  return useQuery({ queryKey: ["convergence", lastN], queryFn: () => collect(api.admin.getConvergenceMetrics({ lastNRounds: lastN })), refetchInterval: 60_000 });
}

export function useRecentRounds(limit = 6) {
  const api = useApi();
  return useQuery({ queryKey: ["rounds", "recent", limit], queryFn: () => collect(api.admin.listRounds({ page: 1, limit })), refetchInterval: 30_000 });
}

export function useFlStatus() {
  const api = useApi();
  return useQuery({ queryKey: ["fl-status"], queryFn: () => api.admin.getFlServerStatus({}), refetchInterval: 15_000 });
}

export const ROUND_STATUS: Record<RoundStatus, { label: string; tone: Tone }> = {
  [RoundStatus.UNSPECIFIED]: { label: "Unknown", tone: "neutral" },
  [RoundStatus.PENDING]: { label: "Pending", tone: "neutral" },
  [RoundStatus.ACTIVE]: { label: "Collecting", tone: "accent" },
  [RoundStatus.AGGREGATING]: { label: "Aggregating", tone: "violet" },
  [RoundStatus.COMPLETE]: { label: "Complete", tone: "ok" },
  [RoundStatus.FAILED]: { label: "Failed", tone: "bad" },
  [RoundStatus.ABORTED]: { label: "Stopped", tone: "warn" },
};

export const FL_STATE: Record<FlServerState, { label: string; tone: Tone }> = {
  [FlServerState.UNSPECIFIED]: { label: "Not reporting", tone: "neutral" },
  [FlServerState.STARTING]: { label: "Starting", tone: "info" },
  [FlServerState.IDLE]: { label: "Idle", tone: "ok" },
  [FlServerState.AGGREGATING]: { label: "Aggregating", tone: "violet" },
  [FlServerState.ERROR]: { label: "Error", tone: "bad" },
};
