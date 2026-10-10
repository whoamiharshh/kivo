import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const COPY = {
  privy: {
    title: "Almost ready",
    body: "Add your Privy app ID to .env.local as NEXT_PUBLIC_PRIVY_APP_ID, then reload. See README step 3.",
  },
  contracts: {
    title: "Almost ready",
    body: "Add the two addresses from the deploy to .env.local as NEXT_PUBLIC_POT_MANAGER_ADDRESS and NEXT_PUBLIC_TEST_RUPEE_ADDRESS, then reload. See README step 2.",
  },
} as const;

export function SetupNotice({ missing }: { missing: keyof typeof COPY }) {
  const { title, body } = COPY[missing];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {body}
        </CardContent>
      </Card>
    </main>
  );
}
