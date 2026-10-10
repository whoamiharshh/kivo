"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { chain } from "@/lib/contracts";
import { PRIVY_APP_ID, privyConfigured } from "@/lib/env";
import { wagmiConfig } from "@/lib/wagmi";
import { SetupNotice } from "@/components/setup-notice";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPreview = pathname?.startsWith("/preview") ?? false;
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4_000, refetchOnWindowFocus: true },
        },
      })
  );

  /**
   * The screen gallery renders without signing in.
   *
   * Every page under /preview is presentational: it takes sample data as props
   * and calls no Privy or chain hook, so it needs neither a provider nor an
   * account. Letting it through means the design can be reviewed on a phone
   * before any third-party integration exists — which is the order the work
   * actually happens in. React Query is still provided, because a component
   * may use it for local state even with nothing to fetch.
   */
  if (isPreview) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  if (!privyConfigured) return <SetupNotice missing="privy" />;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Google only — the brief's one login path.
        loginMethods: ["google"],
        embeddedWallets: {
          // Every user gets a wallet silently on first login; they never see it.
          ethereum: { createOnLogin: "users-without-wallets" },
          // No confirmation modals: actions feel like normal taps.
          showWalletUIs: false,
        },
        defaultChain: chain,
        supportedChains: [chain],
        appearance: {
          theme: "light",
          accentColor: "#4f46e5",
          logo: undefined,
          walletChainType: "ethereum-only",
          showWalletLoginFirst: false,
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
