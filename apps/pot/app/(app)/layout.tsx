import { Providers } from "../providers";

/**
 * Everything a signed-in person uses.
 *
 * A route group rather than a folder, so the URLs stay what they were — /pot,
 * /pay, /join — while these pages get the Privy and wagmi providers.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}
