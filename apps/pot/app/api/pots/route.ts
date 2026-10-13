import { POT_MANAGER_ADDRESS, potManagerAbi } from "@/lib/contracts";
import { reader } from "@/lib/server/chain";
import { db } from "@/lib/server/db";
import { assertIpUnderLimit, assertSameOrigin, GuardError } from "@/lib/server/guards";
import { logServerError } from "@/lib/server/logging";
import { CallerError, verifyCaller } from "@/lib/server/privy";
import { monadTestnet } from "viem/chains";
import type { Address } from "viem";

const ROWS_PER_QUERY = 500;
const RPC_BATCH_SIZE = 100;

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
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

  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(POT_MANAGER_ADDRESS)) {
      return response({ error: "Pot discovery is not configured." }, 503);
    }

    const address = POT_MANAGER_ADDRESS.toLowerCase();
    const { data: sync, error: syncError } = await db()
      .from("pot_activity_sync")
      .select("last_scanned_block")
      .eq("chain_id", monadTestnet.id)
      .eq("contract_address", address)
      .maybeSingle();
    if (syncError || !sync) {
      return response(
        {
          error: "Your pots are still being prepared. Please try again shortly.",
          reason: "pot_index_not_ready",
        },
        503
      );
    }

    const client = reader();
    const finalized = await client.getBlock({ blockTag: "finalized" });
    if (finalized.number === null) {
      throw new Error("RPC did not return a finalized block number.");
    }

    const candidateIds: number[] = [];
    for (let offset = 0; ; offset += ROWS_PER_QUERY) {
      const { data, error } = await db()
        .from("pot_activity_members")
        .select("pot_id")
        .eq("chain_id", monadTestnet.id)
        .eq("contract_address", address)
        .eq("member_address", caller.address.toLowerCase())
        .order("pot_id", { ascending: false })
        .range(offset, offset + ROWS_PER_QUERY - 1);
      if (error) throw new Error("Pot membership lookup failed.");

      const rows = data ?? [];
      for (const row of rows) {
        const potId = Number(row.pot_id);
        if (!Number.isSafeInteger(potId) || potId <= 0) {
          throw new Error("Pot membership index contains an invalid id.");
        }
        candidateIds.push(potId);
      }
      if (rows.length < ROWS_PER_QUERY) break;
    }

    const memberPotIds: number[] = [];
    for (let offset = 0; offset < candidateIds.length; offset += RPC_BATCH_SIZE) {
      const ids = candidateIds.slice(offset, offset + RPC_BATCH_SIZE);
      const membership = (await client.multicall({
        allowFailure: false,
        blockNumber: finalized.number,
        contracts: ids.map((potId) => ({
          address: POT_MANAGER_ADDRESS as Address,
          abi: potManagerAbi,
          functionName: "isMember" as const,
          args: [BigInt(potId), caller.address as Address],
        })),
      })) as boolean[];
      ids.forEach((potId, index) => {
        if (membership[index]) memberPotIds.push(potId);
      });
    }

    return response({
      potIds: memberPotIds,
      isCatchingUp:
        sync.last_scanned_block === null ||
        BigInt(sync.last_scanned_block) < finalized.number,
      sync: {
        indexedThrough:
          sync.last_scanned_block === null
            ? null
            : String(sync.last_scanned_block),
        finalizedBlock: finalized.number.toString(),
      },
    });
  } catch (error) {
    logServerError("pot discovery failed", error);
    return response({ error: "Your pots are temporarily unavailable." }, 503);
  }
}