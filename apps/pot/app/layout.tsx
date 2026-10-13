import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
// Imported for its side effect: validating the configuration before anything
// renders, so a missing key is one clear error at startup rather than a
// confusing failure three screens in. See lib/env.ts.
import "@/lib/env";
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

/**
 * Bricolage Grotesque for headings and amounts only.
 *
 * Inter stays for everything people read at length: it is plain and
 * legible at 15px. Money and titles are what people look at first, so they get
 * a face with a little character — tighter, slightly quirky letterforms that
 * feel friendly rather than corporate. Self-hosted the same way, same
 * `swap` behaviour, and only the three weights the type scale uses.
 */
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700"],
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
    <html lang="en" className={`${inter.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        {/* Providers live in the route-group layouts, not here: the signed-in
            app and the screen gallery need different ones, and deciding
            between them up here would mean reading the current path. */}
        {children}
        {/* The app is light-only, so the toasts are too — not the phone's setting. */}
        <Toaster position="top-center" theme="light" />
      </body>
    </html>
  );
}
