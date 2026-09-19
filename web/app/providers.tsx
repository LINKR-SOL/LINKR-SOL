"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { SolanaProviders } from "@/lib/solana/wallet";
import { ToastProvider } from "@/components/ui/toast";
import { ConnectHint } from "@/components/connect-hint";
import { ExtensionErrorFilter } from "@/components/extension-error-filter";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaProviders>
        {/* One icon weight for the whole app. Phosphor's "regular" is drawn at a
            hairline that disappears against the void palette; "bold" holds up. */}
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <ExtensionErrorFilter />
            <ConnectHint />
            {children}
          </ToastProvider>
        </MotionConfig>
      </SolanaProviders>
    </QueryClientProvider>
  );
}
