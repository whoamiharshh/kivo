import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest, for the server-side logic that has branches worth pinning down.
 *
 * Two bits of setup are load-bearing:
 *
 *  - `server-only` is aliased to an empty module. That package exists to throw
 *    when server code is imported into a client bundle, and a test runner is
 *    neither, so importing it unaliased fails every suite before the first
 *    assertion.
 *  - `test.env` supplies syntactically valid placeholder configuration.
 *    `lib/env.ts` validates at import time, so without these the suite dies on
 *    the import rather than running. The TRUST_SIGNER_KEY below is sixty-four
 *    hex digits of nothing — it is not a key and controls no address.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./lib/server/__mocks__/server-only.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    env: {
      NEXT_PUBLIC_PRIVY_APP_ID: "test-privy-app-id",
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      TRUST_SIGNER_KEY:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    },
  },
});
