import { verifyCaller, CallerError } from "@/lib/server/privy";
import { db } from "@/lib/server/db";
import { assertSameOrigin, assertIpUnderLimit, GuardError } from "@/lib/server/guards";
import { logServerError } from "@/lib/server/logging";
import { reader } from "@/lib/server/chain";
import { POT_MANAGER_ADDRESS, potManagerAbi } from "@/lib/contracts";
import { monadTestnet } from "viem/chains";
import type { Address } from "viem";

const PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function positiveSafeInteger(value: string | null): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertIpUnderLimit(request);
  } catch (error) {
    if (error instanceof GuardError) {
      return response({ error: error.message, reason: error.reason }, error.status);
    }
    return response({ error: "That request could not be checked." }, 400);
  }

  let caller;
  try {
    caller = await verifyCaller(request);
  } catch (error) {
    if (error instanceof CallerError) {
      return response({ error: error.message, reason: error.reason }, error.status);
    }
    return response({ error: "Please sign in again." }, 401);
  }

  const url = new URL(request.url);
  const potId = positiveSafeInteger(url.searchParams.get("potId"));
  const pageSize = positiveSafeInteger(url.searchParams.get("limit")) ?? PAGE_SIZE;
  const cursorBlock = url.searchParams.get("beforeBlock");
  const cursorLog = url.searchParams.get("beforeLog");
  if (
    potId === null ||
    pageSize > MAX_PAGE_SIZE ||
    ((cursorBlock === null) !== (cursorLog === null)) ||
    (cursorBlock !== null && (!/^(0|[1-9][0-9]*)$/.test(cursorBlock) || !/^(0|[1-9][0-9]*)$/.test(cursorLog ?? "")))
  ) {
    return response({ error: "That history link is not valid." }, 400);
  }

  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(POT_MANAGER_ADDRESS)) {
      return response({ error: "Pot history is not configured." }, 503);
    }

    const client = reader();
    const finalized = await client.getBlock({ blockTag: "finalized" });
    const isMember = await client.readContract({
      address: POT_MANAGER_ADDRESS as Address,
      abi: potManagerAbi,
      functionName: "isMember",
      args: [BigInt(potId), caller.address as Address],
      blockNumber: finalized.number,
    });
    if (!isMember) return response({ error: "You are not in this pot." }, 403);

    let query = db()
      .from("pot_activity_events")
      .select(
        "event_name,args,block_number,block_timestamp,transaction_hash,log_index"
      )
      .eq("chain_id", monadTestnet.id)
      .eq("contract_address", POT_MANAGER_ADDRESS.toLowerCase())
      .eq("pot_id", potId);

    if (cursorBlock !== null && cursorLog !== null) {
      query = query.or(
        `block_number.lt.${cursorBlock},and(block_number.eq.${cursorBlock},log_index.lt.${cursorLog})`
      );
    }

    const [{ data, error }, { data: sync, error: syncError }] = await Promise.all([
      query
        .order("block_number", { ascending: false })
        .order("log_index", { ascending: false })
        .limit(pageSize + 1),
      db()
        .from("pot_activity_sync")
        .select("last_scanned_block")
        .eq("chain_id", monadTestnet.id)
        .eq("contract_address", POT_MANAGER_ADDRESS.toLowerCase())
        .maybeSingle(),
    ]);
    if (error || syncError) {
      logServerError("pot-activity database read failed", error ?? syncError);
      return response({ error: "Pot history is temporarily unavailable." }, 503);
    }

    const rows = data ?? [];
    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return response({
      items: page.map((row) => ({
        eventName: row.event_name,
        args: row.args,
        blockNumber: String(row.block_number),
        blockTimestamp: row.block_timestamp,
        transactionHash: row.transaction_hash,
        logIndex: row.log_index,
      })),
      nextCursor:
        hasMore && last
          ? {
              blockNumber: String(last.block_number),
              logIndex: last.log_index,
            }
          : null,
      sync: {
        finalizedBlock: finalized.number.toString(),
        indexedThrough:
          sync?.last_scanned_block === null || sync?.last_scanned_block === undefined
            ? null
            : String(sync.last_scanned_block),
      },
    });
  } catch (error) {
    logServerError("pot-activity request failed", error);
    return response({ error: "Pot history is temporarily unavailable." }, 503);
  }
}