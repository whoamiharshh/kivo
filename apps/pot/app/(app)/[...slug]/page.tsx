import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { isUnbuiltRoute } from "@/lib/nav/routes";

/**
 * Anything under the app that has no screen of its own.
 *
 * Next's own 404 is the right answer for a website and the wrong one here.
 * Somebody judging this app will type a URL they heard in the pitch, or tap a
 * link from a half-finished note, and "404 — This page could not be found" on
 * a black screen reads as *the app is broken*. It is the only screen in the
 * product with none of the product on it.
 *
 * So every unmatched path lands here instead, inside the normal frame, and
 * says the true thing: this part is not finished, here is the way back. A
 * feature named in `lib/nav/routes.ts` but not yet built gets its own name
 * back, so a mistyped URL and an unfinished feature do not read the same.
 *
 * Which path was asked for is read inside a Suspense boundary: it is known
 * only when somebody asks, and reading it any higher would stop the frame
 * around it from being prerendered.
 */
export default function ComingSoonPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  return (
    <AppShell back="/">
      <Suspense fallback={<Frame title="…" body="" />}>
        <Explain params={params} />
      </Suspense>
    </AppShell>
  );
}

async function Explain({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const feature = isUnbuiltRoute(`/${(slug ?? []).join("/")}`);

  return feature ? (
    <Frame
      title={`${feature.label} isn't ready yet`}
      body={`${feature.body} It is being built — it isn't part of the app you can use today.`}
    />
  ) : (
    <Frame
      title="Nothing at this link"
      body="This link doesn't go anywhere. It may be mistyped, or point at something that has moved."
    />
  );
}

function Frame({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[60dvh] flex-col justify-center gap-6 text-center">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>

      <Link
        href="/"
        className="mx-auto text-[15px] font-semibold text-primary underline underline-offset-4"
      >
        Back to your pots
      </Link>
    </div>
  );
}
