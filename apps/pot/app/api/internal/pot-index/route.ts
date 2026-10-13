import { POT_INDEXER_SECRET } from "@/lib/server/env";
import { hasValidIndexerAuthorization } from "@/lib/server/indexer-auth";
import { logServerError } from "@/lib/server/logging";
import { indexPotActivity } from "@/lib/server/pot-indexer";

export async function POST(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = POT_INDEXER_SECRET();
  } catch {
    return Response.json(
      { error: "Pot history indexing is not configured." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  if (!hasValidIndexerAuthorization(request.headers.get("authorization"), secret)) {
    return Response.json(
      { error: "Not authorized." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  try {
    const result = await indexPotActivity();
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    logServerError("pot-indexer run failed", error);
    return Response.json(
      { error: "Pot history indexing is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}