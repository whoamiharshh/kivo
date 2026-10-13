"use client";

/**
 * The people this person can choose from.
 *
 * ──────────────── why a picker and not a text box ────────────────
 *
 * Every feature that moves money to somebody needs to know who. On a chain
 * that means a 42-character address, and there is no version of asking a
 * college student to type or paste one that belongs in this app: it is the
 * single most unforgiving input in software, a wrong character sends money to
 * nobody, and the UI language rule is explicit that the words "wallet" and
 * "address" never reach a screen.
 *
 * So the app never asks. It offers the people you already share a pot with,
 * by the names they chose, and the address stays an implementation detail of
 * the row you tapped. Joining a pot together is the app's existing, deliberate
 * act of "I know this person" — reusing it means there is no separate contacts
 * list to build, populate or keep honest.
 *
 * The cost is real and worth naming: you cannot pay somebody you have never
 * shared a pot with. That is a genuine limit of this version, not an oversight,
 * and the picker says so on screen rather than leaving an empty list to be
 * read as breakage.
 */

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { POT_MANAGER_ADDRESS, potManagerAbi, ready } from "./contracts";
import { loadDisplayNames } from "./store";
import { useMyPots } from "./queries";
import { useAppWallet } from "./tx";

export type Person = {
  address: `0x${string}`;
  /** The name they saved, or a stable friendly tag if they never did. */
  name: string;
  /** Which pots you share, by name — shown so a repeated first name is still
   *  distinguishable ("Rahul · Goa trip" vs "Rahul · Flat groceries"). */
  sharedPots: string[];
};

/** "Friend A91C" — recognisable and stable, with no address on screen. */
export function friendlyTag(address: string): string {
  return `Friend ${address.slice(2, 6).toUpperCase()}`;
}

/**
 * Everyone who is in a pot with you, you excluded.
 *
 * Depends on `useMyPots` rather than re-scanning the logs: that query is
 * already loaded on the home screen and cached, so opening the picker usually
 * costs one multicall for the member lists and one Supabase read for names.
 */
export function useKnownPeople() {
  const { address } = useAppWallet();
  const client = usePublicClient();
  const { data: pots, isLoading: potsLoading } = useMyPots();

  const query = useQuery({
    queryKey: ["known-people", address, (pots ?? []).map((p) => p.potId)],
    enabled: Boolean(address && client && ready.pots && pots),
    queryFn: async (): Promise<Person[]> => {
      const c = client as PublicClient;
      if (!pots || pots.length === 0) return [];

      const memberLists = (await c.multicall({
        allowFailure: false,
        contracts: pots.map((p) => ({
          address: POT_MANAGER_ADDRESS,
          abi: potManagerAbi,
          functionName: "getMembers" as const,
          args: [BigInt(p.potId)],
        })),
      })) as unknown as `0x${string}`[][];

      const mine = address!.toLowerCase();

      // Keyed by lowercased address so the same person met in two pots is one
      // row with two pot names, not two rows.
      const byAddress = new Map<string, Person>();
      memberLists.forEach((members, i) => {
        const potName = pots[i]!.name;
        for (const member of members) {
          const key = member.toLowerCase();
          if (key === mine) continue;
          const existing = byAddress.get(key);
          if (existing) {
            if (!existing.sharedPots.includes(potName)) {
              existing.sharedPots.push(potName);
            }
          } else {
            byAddress.set(key, {
              address: member,
              name: friendlyTag(member),
              sharedPots: [potName],
            });
          }
        }
      });

      const people = [...byAddress.values()];
      if (people.length === 0) return [];

      const names = await loadDisplayNames(people.map((p) => p.address));
      return people
        .map((p) => ({
          ...p,
          // loadDisplayNames lowercases its keys, so the lookup must too.
          name: names[p.address.toLowerCase()]?.trim() || friendlyTag(p.address),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  // The picker needs one loading flag, and "pots still loading" is as much a
  // not-ready-yet as its own query being in flight.
  return { ...query, isLoading: potsLoading || query.isLoading };
}
