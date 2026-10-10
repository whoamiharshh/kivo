import { http } from "wagmi";
import { createConfig } from "@privy-io/wagmi";
import { chain } from "./contracts";

// createConfig and WagmiProvider must come from @privy-io/wagmi, not wagmi —
// Privy needs reconnectOnMount:false for the embedded wallet to attach cleanly.
export const wagmiConfig = createConfig({
  chains: [chain],
  transports: {
    [chain.id]: http(chain.rpcUrls.default.http[0]),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
