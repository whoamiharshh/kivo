"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { chain } from "@/lib/contracts";
import { PRIVY_APP_ID, privyConfigured } from "@/lib/env";
import { wagmiConfig } from "@/lib/wagmi";
import { SetupNotice } from "@/components/setup-notice";

function useAppQueryClient() {
  return useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4_000, refetchOnWindowFocus: true },
        },
      })
  )[0];
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = useAppQueryClient();

  // Without sign-in configured there is nothing the app can honestly show.
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
