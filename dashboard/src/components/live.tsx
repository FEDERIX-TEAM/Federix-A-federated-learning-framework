"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/components/auth";
import { isSessionExpired } from "@/lib/api";
import { INVALIDATES, parsePayload, type FeedEvent } from "@/lib/events";

export type StreamState = "connecting" | "live" | "reconnecting";

interface LiveValue {
  state: StreamState;
  events: FeedEvent[];
  connectedAt: string | null;
}

const LiveContext = createContext<LiveValue>({ state: "connecting", events: [], connectedAt: null });
const MAX_EVENTS = 60;

export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>("connecting");
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let attempt = 0;

    async function run() {
      while (!controller.signal.aborted) {
        setState(attempt === 0 ? "connecting" : "reconnecting");
        try {
          for await (const ev of api.events.subscribe({}, { signal: controller.signal })) {
            if (ev.type === "ping") continue;
            if (ev.type === "connected") {
              attempt = 0;
              setState("live");
              setConnectedAt(ev.timestamp);
              for (const key of [["overview"], ["rounds"], ["convergence"], ["fl-status"]]) queryClient.invalidateQueries({ queryKey: key });
              continue;
            }
            const item: FeedEvent = { id: `${Date.now()}-${(seq.current += 1)}`, type: ev.type, at: ev.timestamp, payload: parsePayload(ev.payloadJson) };
            setEvents((prev) => [item, ...prev].slice(0, MAX_EVENTS));
            for (const key of INVALIDATES[ev.type] ?? []) queryClient.invalidateQueries({ queryKey: key });
          }
        } catch (err) {
          if (controller.signal.aborted || isSessionExpired(err)) return;
        }
        if (controller.signal.aborted) return;
        attempt += 1;
        setState("reconnecting");
        const wait = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, wait);
          controller.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    }

    void run();
    return () => controller.abort();
  }, [api, queryClient]);

  const value = useMemo(() => ({ state, events, connectedAt }), [state, events, connectedAt]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveEvents(): LiveValue {
  return useContext(LiveContext);
}
