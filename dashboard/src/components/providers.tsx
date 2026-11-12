"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Code, ConnectError } from "@connectrpc/connect";
import { AuthProvider } from "@/components/auth";
import { RuntimeProvider } from "@/components/runtime";
import { ThemeProvider } from "@/components/theme";
import { isSessionExpired } from "@/lib/api";
import type { RuntimeConfig } from "@/lib/runtime";

const NO_RETRY = new Set([Code.Unauthenticated, Code.PermissionDenied, Code.InvalidArgument, Code.NotFound, Code.FailedPrecondition]);

export function Providers({ config, children }: { config: RuntimeConfig; children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !isSessionExpired(err) && !NO_RETRY.has(ConnectError.from(err).code) && count < 2,
          },
        },
      }),
  );
  return (
    <RuntimeProvider config={config}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </RuntimeProvider>
  );
}
