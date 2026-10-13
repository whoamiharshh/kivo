import "server-only";
import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  decodeEventLog,
  http,
  type Address,
} from "viem";
import { monadTestnet } from "viem/chains";
import { DEPLOY_BLOCK, POT_MANAGER_ADDRESS, potManagerAbi } from "@/lib/contracts";
import { memberAddressForEvent, type PotEventName } from "@/lib/activity";
import type { Insert, Json } from "./database.types";
import { db } from "./db";
import { logServerError } from "./logging";

const BLOCKS_PER_RANGE = 100n;
const MAX_RANGES_PER_RUN = 20;
const LEASE_SECONDS = 110;
const EVENT_NAMES = new Set([
  "PotCreated",
  "MemberJoined",
  "Deposited",
  "PotFunded",
  "RefundingStarted",
  "SpendRequested",
  "SpendApproved",
  "SpendCancelled",
  "SpendExecuted",
  "PotClosed",
  "Refunded",
]);

type SyncRow = {
  next_block: number;
  last_scanned_block: number | null;
  last_scanned_hash: string | null;
};

function chainClient() {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(process.env.NEXT_PUBLIC_RPC_URL || undefined),
  });
}

function asJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase();
  }
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, asJsonValue(item)])
    );
  }
  return value;
}

async function saveRows(
  rows: Insert<"pot_activity_events">[]
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await db()
      .from("pot_activity_events")
      .upsert(rows.slice(offset, offset + 500), {
        onConflict: "chain_id,contract_address,transaction_hash,log_index",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`Pot activity event write failed: ${error.code}`);
  }
}

async function saveMemberRows(
  rows: Insert<"pot_activity_members">[]
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await db()
      .from("pot_activity_members")
      .upsert(rows.slice(offset, offset + 500), {
        onConflict: "chain_id,contract_address,pot_id,member_address",
        ignoreDuplicates: true,
      });
    if (error) throw new Error("Pot membership index write failed.");
  }
}

export type PotIndexResult = {
  status: "indexed" | "up-to-date" | "busy";
  finalizedBlock: string;
  scannedFrom?: string;
  scannedTo?: string;
  eventCount?: number;
  hasMore?: boolean;
};

export async function indexPotActivity(): Promise<PotIndexResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(POT_MANAGER_ADDRESS)) {
    throw new Error("PotManager is not configured for indexing.");
  }

  const client = chainClient();
  const finalized = await client.getBlock({ blockTag: "finalized" });
  const finalizedBlock = finalized.number;
  if (finalizedBlock === null || finalized.hash === null) {
    throw new Error("The RPC did not return a finalized block identity.");
  }

  const address = POT_MANAGER_ADDRESS.toLowerCase();
  const contractAddress = address as Address;
  const owner = randomUUID();
  const { data: acquired, error: leaseError } = await db().rpc(
    "claim_pot_activity_lease",
    {
      p_chain_id: monadTestnet.id,
      p_contract_address: address,
      p_owner: owner,
      p_lease_seconds: LEASE_SECONDS,
    }
  );
  if (leaseError) throw new Error("Could not acquire Pot activity index lease.");
  if (!acquired) return { status: "busy", finalizedBlock: finalizedBlock.toString() };

  try {
    const { data: saved, error: syncError } = await db()
      .from("pot_activity_sync")
      .select("next_block,last_scanned_block,last_scanned_hash")
      .eq("chain_id", monadTestnet.id)
      .eq("contract_address", address)
      .maybeSingle();
    if (syncError) throw new Error("Could not read Pot activity checkpoint.");

    const sync = saved as SyncRow | null;
    let nextBlock = sync ? BigInt(sync.next_block) : DEPLOY_BLOCK;
    if (nextBlock < 0n) throw new Error("Pot activity checkpoint is invalid.");

    if (sync?.last_scanned_block !== null && sync?.last_scanned_block !== undefined) {
      const checkpointBlock = await client.getBlock({
        blockNumber: BigInt(sync.last_scanned_block),
      });
      if (
        !checkpointBlock.hash ||
        checkpointBlock.hash.toLowerCase() !== sync.last_scanned_hash?.toLowerCase()
      ) {
        throw new Error(
          "Finalized Pot activity checkpoint changed; stop indexing and reconcile before continuing."
        );
      }
    }

    if (!sync) {
      const { error } = await db().from("pot_activity_sync").insert({
        chain_id: monadTestnet.id,
        contract_address: address,
        next_block: Number(nextBlock),
      });
      if (error) throw new Error("Could not initialize Pot activity checkpoint.");
    }

    if (nextBlock > finalizedBlock) {
      return { status: "up-to-date", finalizedBlock: finalizedBlock.toString() };
    }

    const scannedFrom = nextBlock;
    let scannedTo = nextBlock - 1n;
    let eventCount = 0;

    for (let range = 0; range < MAX_RANGES_PER_RUN && nextBlock <= finalizedBlock; range++) {
      const toBlock = nextBlock + BLOCKS_PER_RANGE - 1n;
      scannedTo = toBlock < finalizedBlock ? toBlock : finalizedBlock;
      const logs = await client.getLogs({
        address: contractAddress,
        fromBlock: nextBlock,
        toBlock: scannedTo,
      });

      const decoded = logs.flatMap((log) => {
        if (!log.blockNumber || !log.blockHash || !log.transactionHash || log.logIndex === null) {
          throw new Error("RPC returned an incomplete finalized event.");
        }
        try {
          const event = decodeEventLog({
            abi: potManagerAbi,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          if (!EVENT_NAMES.has(event.eventName)) return [];
          const args = asJsonValue(event.args) as Record<string, unknown>;
          const potId = args.potId;
          if (typeof potId !== "string" || !/^[0-9]+$/.test(potId) || potId === "0") {
            throw new Error("RPC returned a Pot event without a valid pot id.");
          }
          return [{ log, eventName: event.eventName, args, potId }];
        } catch (error) {
          if (error instanceof Error && error.message.includes("valid pot id")) throw error;
          throw new Error("RPC returned an undecodable Pot activity event.");
        }
      });

      const timestamps = new Map<bigint, string>();
      const blockNumbers = [...new Set(decoded.map(({ log }) => log.blockNumber!))];
      for (let offset = 0; offset < blockNumbers.length; offset += 10) {
        const blocks = await Promise.all(
          blockNumbers.slice(offset, offset + 10).map((blockNumber) =>
            client.getBlock({ blockNumber })
          )
        );
        for (const block of blocks) {
          timestamps.set(block.number, new Date(Number(block.timestamp) * 1000).toISOString());
        }
      }

      const rows: Insert<"pot_activity_events">[] = decoded.map(
        ({ log, eventName, args, potId }) => {
          const blockTimestamp = timestamps.get(log.blockNumber!);
          if (!blockTimestamp) throw new Error("Could not timestamp a Pot activity event.");
          const potNumber = Number(potId);
          if (!Number.isSafeInteger(potNumber)) {
            throw new Error("Pot id exceeds the supported database integer range.");
          }
          return {
            chain_id: monadTestnet.id,
            contract_address: address,
            pot_id: potNumber,
            block_number: Number(log.blockNumber),
            block_hash: log.blockHash!.toLowerCase(),
            transaction_hash: log.transactionHash!.toLowerCase(),
            log_index: log.logIndex!,
            event_name: eventName,
            args: args as Json,
            block_timestamp: blockTimestamp,
          };
        }
      );
      const memberRows: Insert<"pot_activity_members">[] = decoded.flatMap(
        ({ log, eventName, args, potId }) => {
          const memberAddress = memberAddressForEvent(
            eventName as PotEventName,
            args as Record<string, string | boolean>
          );
          if (!memberAddress) return [];
          const potNumber = Number(potId);
          if (!Number.isSafeInteger(potNumber)) {
            throw new Error("Pot id exceeds the supported database integer range.");
          }
          return [
            {
              chain_id: monadTestnet.id,
              contract_address: address,
              pot_id: potNumber,
              member_address: memberAddress.toLowerCase(),
              joined_block: Number(log.blockNumber),
              joined_log_index: log.logIndex!,
            },
          ];
        }
      );
      await saveRows(rows);
      await saveMemberRows(memberRows);
      eventCount += rows.length;

      const endBlock = await client.getBlock({ blockNumber: scannedTo });
      if (!endBlock.hash) throw new Error("Could not verify the finalized block hash.");
      nextBlock = scannedTo + 1n;
      const { error } = await db()
        .from("pot_activity_sync")
        .update({
          next_block: Number(nextBlock),
          last_scanned_block: Number(scannedTo),
          last_scanned_hash: endBlock.hash,
          updated_at: new Date().toISOString(),
        })
        .eq("chain_id", monadTestnet.id)
        .eq("contract_address", address);
      if (error) throw new Error("Could not advance Pot activity checkpoint.");
    }

    return {
      status: "indexed",
      finalizedBlock: finalizedBlock.toString(),
      scannedFrom: scannedFrom.toString(),
      scannedTo: scannedTo.toString(),
      eventCount,
      hasMore: nextBlock <= finalizedBlock,
    };
  } finally {
    const { error } = await db().rpc("release_pot_activity_lease", {
      p_chain_id: monadTestnet.id,
      p_contract_address: address,
      p_owner: owner,
    });
    if (error) logServerError("pot-indexer lease release failed", error);
  }
}