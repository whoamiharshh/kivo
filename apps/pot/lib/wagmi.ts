import { fallback, http } from "wagmi";
import { createConfig } from "@privy-io/wagmi";
import { chain } from "./contracts";

// createConfig and WagmiProvider must come from @privy-io/wagmi, not wagmi —
// Privy needs reconnectOnMount:false for the embedded wallet to attach cleanly.
export const wagmiConfig = createConfig({
  chains: [chain],
  transports: {
    /**
     * Five endpoints, not one, and what happens when they say no.
     *
     * ──────────────── why a fallback and not a single URL ────────────────
     *
     * Monad's public RPC rate limits per address, and the limit bites far
     * lower than it looks. Measured against it: ten concurrent contract reads
     * from one address mostly succeed; thirty mostly fail with HTTP 429.
     * That is fine for one person and useless for a room of people sharing
     * one wifi, which is exactly what a demo or a class test looks like from
     * the outside.
     *
     * Each public endpoint keeps its own counter, so spreading reads across
     * several multiplies the ceiling for nothing. `rank` lets viem measure
     * latency and stability and prefer whichever is healthiest right now,
     * which also means an endpoint going down is routed around rather than
     * taking the app with it — a single public URL is a single point of
     * failure for every screen at once.
     *
     * JSON-RPC batching was tried here and measured: it did not help, because
     * the limit counts requests over a short window rather than bytes, and a
     * screen already makes only a couple. It is deliberately left off rather
     * than shipped as a fix that merely looks like one.
     *
     * `NEXT_PUBLIC_RPC_URL` is tried first when set, for a dedicated endpoint
     * with its own key, which is still the right answer for real traffic.
     *
     * `retryDelay` matters as much as `retryCount`: viem retries a 429 by
     * default, and retrying a rate limit immediately is how a busy minute
     * becomes an outage.
     */
    [chain.id]: fallback(
      [
        ...(process.env.NEXT_PUBLIC_RPC_URL
          ? [process.env.NEXT_PUBLIC_RPC_URL]
          : []),
        "https://testnet-rpc.monad.xyz",
        "https://rpc.ankr.com/monad_testnet",
        "https://monad-testnet.drpc.org",
        "https://rpc-testnet.monadinfra.com",
        "https://10143.rpc.thirdweb.com",
      ].map((url) => http(url, { retryCount: 1, retryDelay: 400 })),
      { rank: { interval: 30_000 }, retryCount: 2, retryDelay: 300 }
    ),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
