"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { chain } from "@/lib/contracts";
import { PRIVY_APP_ID, privyConfigured } from "@/lib/env";
import { wagmiConfig } from "@/lib/wagmi";
import { SetupNotice } from "@/components/setup-notice";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4_000, refetchOnWindowFocus: true },
        },
      })
  );

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
          accentColor: "#0f7b5f",
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
