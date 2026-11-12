"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { RuntimeConfig } from "@/lib/runtime";

const RuntimeContext = createContext<RuntimeConfig | null>(null);

export function RuntimeProvider({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  return <RuntimeContext.Provider value={config}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): RuntimeConfig {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("useRuntime must be used inside RuntimeProvider");
  return ctx;
}
