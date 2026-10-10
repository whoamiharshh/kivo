import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
// Imported for its side effect: validating the configuration before anything
// renders, so a missing key is one clear error at startup rather than a
// confusing failure three screens in. See lib/env.ts.
import "@/lib/env";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";

/**
 * Inter, self-hosted by next/font so there is no request to Google at runtime
 * and no layout shift while it loads.
 *
 * `display: "swap"` shows the fallback immediately rather than blocking paint
 * on the font — the first thing a person sees is their money, not a blank
 * screen. Only the four weights the type scale actually uses are fetched.
 */
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Pot — the shared money box for your group",
  description:
    "Everyone puts money in, the pot repays whoever paid under rules you agree up front, and leftover money comes back to each person automatically.",
  applicationName: "Pot",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximum-scale: someone who needs to pinch-zoom an amount must be able to.
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <Providers>{children}</Providers>
        {/* The app is light-only, so the toasts are too — not the phone's setting. */}
        <Toaster position="top-center" theme="light" />
      </body>
    </html>
  );
}
