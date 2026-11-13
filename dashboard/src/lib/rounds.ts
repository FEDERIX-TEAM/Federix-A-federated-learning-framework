"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/components/auth";
import { collect } from "@/lib/queries";

export const PAGE_SIZE = 20;

export function useRoundsList(status: string) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ["rounds", "list", status],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => collect(api.admin.listRounds({ page: pageParam, limit: PAGE_SIZE, status })),
    getNextPageParam: (last, pages) => (last.length === PAGE_SIZE ? pages.length + 1 : undefined),
    refetchInterval: 30_000,
  });
}

export function useRoundDetail(roundId: string) {
  const api = useApi();
  return useQuery({ queryKey: ["rounds", "detail", roundId], queryFn: () => api.admin.getRoundDetail({ roundId }), refetchInterval: 20_000 });
}

export function useRoundUpdates(roundId: string) {
  const api = useApi();
  return useQuery({ queryKey: ["rounds", "updates", roundId], queryFn: () => collect(api.admin.listRoundUpdates({ roundId })), refetchInterval: 20_000 });
}

export function useAdminConfig() {
  const api = useApi();
  return useQuery({ queryKey: ["config"], queryFn: () => api.admin.getConfig({}), staleTime: 60_000 });
}

function useInvalidateRounds() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["rounds"] });
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
  };
}

export function useStartRound() {
  const api = useApi();
  const invalidate = useInvalidateRounds();
  return useMutation({
    mutationFn: (input: { maxClients: number; deadlineSeconds: number; notes: string }) => api.admin.startRound(input),
    onSuccess: invalidate,
  });
}

export function useStopRound() {
  const api = useApi();
  const invalidate = useInvalidateRounds();
  return useMutation({
    mutationFn: (input: { roundId: string; reason: string }) => api.admin.stopRound(input),
    onSuccess: invalidate,
  });
}
