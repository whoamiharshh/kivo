"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  supabaseConfigured,
} from "./env";

/**
 * Offchain text: pot names, people's display names, and what a repayment was
 * for. Only hashes of these ever go onchain.
 *
 * Supabase when it's configured; otherwise this falls back to the browser's
 * own storage so the app is still fully usable for a single-device demo.
 */

export type PotMeta = {
  potId: number;
  name: string;
  perPersonPaise: string;
  /**
   * The invite code, for the creator only, and only from this device.
   *
   * It is NOT readable from Supabase with the key this app holds - that was
   * C-1 in docs/security-audit.md, where every pot's code was world-readable.
   * So a loaded pot has `inviteCode: null` unless this browser is the one
   * that created it. A creator who clears site data loses their own invite
   * link; the pot and its money are untouched.
   */
  inviteCode: string | null;
  /** Privy DID of whoever created the pot. Write-only, like the code. */
  creatorDid?: string | null;
};

let client: SupabaseClient | null = null;
function sb(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  return client;
}

// ───────────── on-device fallback ─────────────

const LS = {
  pot: (id: number) => `pot:meta:${id}`,
  name: (a: string) => `pot:name:${a.toLowerCase()}`,
  memo: (h: string) => `pot:memo:${h.toLowerCase()}`,
};

function lsGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be blocked or full — the app still works, text just won't persist */
  }
}

// ───────────── pot names ─────────────

export async function savePotMeta(meta: PotMeta): Promise<void> {
  lsSet(LS.pot(meta.potId), meta);
  const c = sb();
  if (!c) return;

  // Display text. World-readable, and meant to be: a pot name and a share are
  // what the group puts in a WhatsApp message anyway.
  await c.from("pots").upsert(
    {
      pot_id: meta.potId,
      name: meta.name,
      per_person_paise: meta.perPersonPaise,
    },
    { onConflict: "pot_id" }
  );

  // The invite code goes to a separate table that this key can write and
  // cannot read. It is never selected anywhere in this file. The creator's own
  // copy lives in local storage above; the server reads the table to check a
  // joiner's code. See supabase/migrations/20261010_split_invite_codes.sql.
  if (meta.inviteCode) {
    await c
      .from("pots_private")
      .insert({
        pot_id: meta.potId,
        invite_code: meta.inviteCode,
        creator_did: meta.creatorDid ?? null,
      })
      // A pot's code is written once. A second attempt means the row is
      // already there, and overwriting it could only break a working invite.
      .select()
      .maybeSingle();
  }
}

export async function loadPotMeta(potId: number): Promise<PotMeta | null> {
  const c = sb();
  if (c) {
    const { data } = await c
      .from("pots")
      .select("pot_id,name,per_person_paise")
      .eq("pot_id", potId)
      .maybeSingle();
    if (data) {
      const meta: PotMeta = {
        potId: Number(data.pot_id),
        name: data.name,
        perPersonPaise: String(data.per_person_paise ?? "0"),
        // Only this device can know the code. See PotMeta.inviteCode.
        inviteCode: lsGet<PotMeta>(LS.pot(potId))?.inviteCode ?? null,
      };
      lsSet(LS.pot(potId), meta);
      return meta;
    }
  }
  return lsGet<PotMeta>(LS.pot(potId));
}

export async function loadPotMetas(
  potIds: number[]
): Promise<Record<number, PotMeta>> {
  const result: Record<number, PotMeta> = {};
  if (potIds.length === 0) return result;

  const c = sb();
  if (c) {
    const { data } = await c
      .from("pots")
      .select("pot_id,name,per_person_paise")
      .in("pot_id", potIds);
    for (const row of data ?? []) {
      const meta: PotMeta = {
        potId: Number(row.pot_id),
        name: row.name,
        perPersonPaise: String(row.per_person_paise ?? "0"),
        inviteCode:
          lsGet<PotMeta>(LS.pot(Number(row.pot_id)))?.inviteCode ?? null,
      };
      result[meta.potId] = meta;
      lsSet(LS.pot(meta.potId), meta);
    }
  }
  for (const id of potIds) {
    if (!result[id]) {
      const local = lsGet<PotMeta>(LS.pot(id));
      if (local) result[id] = local;
    }
  }
  return result;
}

// ───────────── people's names ─────────────

export async function saveDisplayName(
  address: string,
  name: string
): Promise<void> {
  const key = address.toLowerCase();
  lsSet(LS.name(key), name);
  const c = sb();
  if (!c) return;
  await c
    .from("profiles")
    .upsert({ address: key, name }, { onConflict: "address" });
}

export async function loadDisplayNames(
  addresses: string[]
): Promise<Record<string, string>> {
  const keys = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out: Record<string, string> = {};
  if (keys.length === 0) return out;

  const c = sb();
  if (c) {
    const { data } = await c
      .from("profiles")
      .select("address,name")
      .in("address", keys);
    for (const row of data ?? []) {
      out[row.address.toLowerCase()] = row.name;
      lsSet(LS.name(row.address), row.name);
    }
  }
  for (const k of keys) {
    if (!out[k]) {
      const local = lsGet<string>(LS.name(k));
      if (local) out[k] = local;
    }
  }
  return out;
}

// ───────────── repayment memos ─────────────

export async function saveMemo(hash: string, text: string): Promise<void> {
  const key = hash.toLowerCase();
  lsSet(LS.memo(key), text);
  const c = sb();
  if (!c) return;
  await c.from("memos").upsert({ hash: key, text }, { onConflict: "hash" });
}

export async function loadMemos(
  hashes: string[]
): Promise<Record<string, string>> {
  const keys = [...new Set(hashes.map((h) => h.toLowerCase()))].filter(
    (h) => h && !/^0x0{64}$/.test(h)
  );
  const out: Record<string, string> = {};
  if (keys.length === 0) return out;

  const c = sb();
  if (c) {
    const { data } = await c.from("memos").select("hash,text").in("hash", keys);
    for (const row of data ?? []) {
      out[row.hash.toLowerCase()] = row.text;
      lsSet(LS.memo(row.hash), row.text);
    }
  }
  for (const k of keys) {
    if (!out[k]) {
      const local = lsGet<string>(LS.memo(k));
      if (local) out[k] = local;
    }
  }
  return out;
}
