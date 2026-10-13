/**
 * Database types for the Supabase project.
 *
 * Generated shapes, kept in the repo so the server is type-checked against the
 * real schema rather than against assumptions. Regenerate after any migration:
 *
 *   npx supabase gen types typescript --project-id <ref> > lib/server/database.types.ts
 *
 * The generator also emits `Tables<>`/`TablesInsert<>` helper generics; this
 * file keeps only the `Database` shape, which is all `createClient<Database>`
 * needs, and derives row types directly from it.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  public: {
    Tables: {
      audit_log: {
        Row: {
          actor_address: string | null;
          actor_did: string | null;
          amount_paise: number | null;
          counterparty_did: string | null;
          created_at: string;
          detail: Json;
          event: string;
          id: number;
          payment_id: number | null;
        };
        Insert: {
          actor_address?: string | null;
          actor_did?: string | null;
          amount_paise?: number | null;
          counterparty_did?: string | null;
          created_at?: string;
          detail?: Json;
          event: string;
          id?: number;
          payment_id?: number | null;
        };
        Update: {
          actor_address?: string | null;
          actor_did?: string | null;
          amount_paise?: number | null;
          counterparty_did?: string | null;
          created_at?: string;
          detail?: Json;
          event?: string;
          id?: number;
          payment_id?: number | null;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          contact_did: string;
          created_at: string;
          nickname: string | null;
          owner_did: string;
        };
        Insert: {
          contact_did: string;
          created_at?: string;
          nickname?: string | null;
          owner_did: string;
        };
        Update: {
          contact_did?: string;
          created_at?: string;
          nickname?: string | null;
          owner_did?: string;
        };
        Relationships: [];
      };
      behaviour_signals: {
        Row: {
          id: number;
          subject: Database["public"]["Enums"]["behaviour_subject"];
          subject_id: number;
          member_did: string;
          for_day: string;
          metric: Database["public"]["Enums"]["behaviour_metric"];
          value: number;
          bound_applied: number;
          signal_sha256: string;
          nonce_id: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          subject: Database["public"]["Enums"]["behaviour_subject"];
          subject_id: number;
          member_did: string;
          for_day: string;
          metric: Database["public"]["Enums"]["behaviour_metric"];
          value: number;
          bound_applied: number;
          signal_sha256: string;
          nonce_id?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          subject?: Database["public"]["Enums"]["behaviour_subject"];
          subject_id?: number;
          member_did?: string;
          for_day?: string;
          metric?: Database["public"]["Enums"]["behaviour_metric"];
          value?: number;
          bound_applied?: number;
          signal_sha256?: string;
          nonce_id?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      employer_attestations: {
        Row: {
          id: number;
          employer_address: string;
          owner_did: string;
          entity_proof: string;
          proof_kind: string;
          verified: boolean;
          nonce_id: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          employer_address: string;
          owner_did: string;
          entity_proof: string;
          proof_kind?: string;
          verified?: boolean;
          nonce_id?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          employer_address?: string;
          owner_did?: string;
          entity_proof?: string;
          proof_kind?: string;
          verified?: boolean;
          nonce_id?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      gift_conditions: {
        Row: {
          id: number;
          gift_id: number;
          condition_text: string;
          condition_hash: string;
          evidence_hash: string | null;
          attester_did: string | null;
          attested_at: string | null;
          nonce_id: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          gift_id: number;
          condition_text: string;
          condition_hash: string;
          evidence_hash?: string | null;
          attester_did?: string | null;
          attested_at?: string | null;
          nonce_id?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          gift_id?: number;
          condition_text?: string;
          condition_hash?: string;
          evidence_hash?: string | null;
          attester_did?: string | null;
          attested_at?: string | null;
          nonce_id?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      income_declarations: {
        Row: {
          id: number;
          agreement_id: number;
          recipient_did: string;
          for_month: string;
          income_paise: number;
          source: string;
          nonce_id: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          agreement_id: number;
          recipient_did: string;
          for_month: string;
          income_paise: number;
          source?: string;
          nonce_id?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          agreement_id?: number;
          recipient_did?: string;
          for_month?: string;
          income_paise?: number;
          source?: string;
          nonce_id?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      oracle_events: {
        Row: {
          id: number;
          policy_id: number;
          event_type: string;
          event_occurred: boolean;
          source: string;
          payout_paise: number;
          nonce_id: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          policy_id: number;
          event_type: string;
          event_occurred: boolean;
          source?: string;
          payout_paise?: number;
          nonce_id?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          policy_id?: number;
          event_type?: string;
          event_occurred?: boolean;
          source?: string;
          payout_paise?: number;
          nonce_id?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      trust_nonces: {
        Row: {
          id: number;
          nonce: string;
          signer_did: string;
          action_type: string;
          payload_hash: string;
          created_at: string;
          expires_at: string;
          used_at: string | null;
        };
        Insert: {
          id?: number;
          nonce: string;
          signer_did: string;
          action_type: string;
          payload_hash: string;
          created_at?: string;
          expires_at: string;
          used_at?: string | null;
        };
        Update: {
          id?: number;
          nonce?: string;
          signer_did?: string;
          action_type?: string;
          payload_hash?: string;
          created_at?: string;
          expires_at?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      memos: {
        Row: { created_at: string; hash: string; text: string };
        Insert: { created_at?: string; hash: string; text: string };
        Update: { created_at?: string; hash?: string; text?: string };
        Relationships: [];
      };
      payments: {
        Row: {
          amount_paise: number;
          claim_expires_at: string | null;
          confirm_due_at: string | null;
          confirm_window_s: number;
          created_at: string;
          id: number;
          kind: Database["public"]["Enums"]["payment_kind"];
          memo_hash: string;
          memo_text: string | null;
          onchain_id: number | null;
          recipient_address: string | null;
          recipient_did: string | null;
          recipient_hint: string | null;
          sender_address: string;
          sender_did: string;
          status: Database["public"]["Enums"]["payment_status"];
          stepup_verified: boolean;
          tx_hash: string | null;
          updated_at: string;
        };
        Insert: {
          amount_paise: number;
          claim_expires_at?: string | null;
          confirm_due_at?: string | null;
          confirm_window_s: number;
          created_at?: string;
          id?: number;
          kind: Database["public"]["Enums"]["payment_kind"];
          memo_hash: string;
          memo_text?: string | null;
          onchain_id?: number | null;
          recipient_address?: string | null;
          recipient_did?: string | null;
          recipient_hint?: string | null;
          sender_address: string;
          sender_did: string;
          status?: Database["public"]["Enums"]["payment_status"];
          stepup_verified?: boolean;
          tx_hash?: string | null;
          updated_at?: string;
        };
        Update: {
          amount_paise?: number;
          claim_expires_at?: string | null;
          confirm_due_at?: string | null;
          confirm_window_s?: number;
          created_at?: string;
          id?: number;
          kind?: Database["public"]["Enums"]["payment_kind"];
          memo_hash?: string;
          memo_text?: string | null;
          onchain_id?: number | null;
          recipient_address?: string | null;
          recipient_did?: string | null;
          recipient_hint?: string | null;
          sender_address?: string;
          sender_did?: string;
          status?: Database["public"]["Enums"]["payment_status"];
          stepup_verified?: boolean;
          tx_hash?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      pot_activity_events: {
        Row: {
          args: Json;
          block_hash: string;
          block_number: number;
          block_timestamp: string;
          chain_id: number;
          contract_address: string;
          event_name: string;
          indexed_at: string;
          log_index: number;
          pot_id: number;
          transaction_hash: string;
        };
        Insert: {
          args: Json;
          block_hash: string;
          block_number: number;
          block_timestamp: string;
          chain_id: number;
          contract_address: string;
          event_name: string;
          indexed_at?: string;
          log_index: number;
          pot_id: number;
          transaction_hash: string;
        };
        Update: {
          args?: Json;
          block_hash?: string;
          block_number?: number;
          block_timestamp?: string;
          chain_id?: number;
          contract_address?: string;
          event_name?: string;
          indexed_at?: string;
          log_index?: number;
          pot_id?: number;
          transaction_hash?: string;
        };
        Relationships: [];
      };
      pot_activity_members: {
        Row: {
          chain_id: number;
          contract_address: string;
          indexed_at: string;
          joined_block: number;
          joined_log_index: number;
          member_address: string;
          pot_id: number;
        };
        Insert: {
          chain_id: number;
          contract_address: string;
          indexed_at?: string;
          joined_block: number;
          joined_log_index: number;
          member_address: string;
          pot_id: number;
        };
        Update: {
          chain_id?: number;
          contract_address?: string;
          indexed_at?: string;
          joined_block?: number;
          joined_log_index?: number;
          member_address?: string;
          pot_id?: number;
        };
        Relationships: [];
      };
      pot_activity_sync: {
        Row: {
          chain_id: number;
          contract_address: string;
          last_scanned_block: number | null;
          last_scanned_hash: string | null;
          next_block: number;
          updated_at: string;
        };
        Insert: {
          chain_id: number;
          contract_address: string;
          last_scanned_block?: number | null;
          last_scanned_hash?: string | null;
          next_block: number;
          updated_at?: string;
        };
        Update: {
          chain_id?: number;
          contract_address?: string;
          last_scanned_block?: number | null;
          last_scanned_hash?: string | null;
          next_block?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      pot_activity_leases: {
        Row: {
          chain_id: number;
          contract_address: string;
          expires_at: string;
          lease_owner: string;
        };
        Insert: {
          chain_id: number;
          contract_address: string;
          expires_at: string;
          lease_owner: string;
        };
        Update: {
          chain_id?: number;
          contract_address?: string;
          expires_at?: string;
          lease_owner?: string;
        };
        Relationships: [];
      };
      pots: {
        Row: {
          created_at: string;
          name: string;
          per_person_paise: number;
          pot_id: number;
        };
        Insert: {
          created_at?: string;
          name: string;
          per_person_paise?: number;
          pot_id: number;
        };
        Update: {
          created_at?: string;
          name?: string;
          per_person_paise?: number;
          pot_id?: number;
        };
        Relationships: [];
      };
      pots_private: {
        Row: {
          created_at: string;
          creator_did: string | null;
          invite_code: string;
          pot_id: number;
        };
        Insert: {
          created_at?: string;
          creator_did?: string | null;
          invite_code: string;
          pot_id: number;
        };
        Update: {
          created_at?: string;
          creator_did?: string | null;
          invite_code?: string;
          pot_id?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: { address: string; name: string; updated_at: string };
        Insert: { address: string; name: string; updated_at?: string };
        Update: { address?: string; name?: string; updated_at?: string };
        Relationships: [];
      };
      send_limits: {
        Row: {
          claim_expiry_days: number;
          daily_total_paise: number;
          default_confirm_window_s: number;
          id: boolean;
          pair_daily_count: number;
          pair_daily_total_paise: number;
          stepup_threshold_paise: number;
        };
        Insert: {
          claim_expiry_days?: number;
          daily_total_paise?: number;
          default_confirm_window_s?: number;
          id?: boolean;
          pair_daily_count?: number;
          pair_daily_total_paise?: number;
          stepup_threshold_paise?: number;
        };
        Update: {
          claim_expiry_days?: number;
          daily_total_paise?: number;
          default_confirm_window_s?: number;
          id?: boolean;
          pair_daily_count?: number;
          pair_daily_total_paise?: number;
          stepup_threshold_paise?: number;
        };
        Relationships: [];
      };
      users: {
        Row: {
          address: string;
          created_at: string;
          did: string;
          display_name: string | null;
          email: string | null;
          handle: string | null;
          passkey_enrolled: boolean;
          updated_at: string;
        };
        Insert: {
          address: string;
          created_at?: string;
          did: string;
          display_name?: string | null;
          email?: string | null;
          handle?: string | null;
          passkey_enrolled?: boolean;
          updated_at?: string;
        };
        Update: {
          address?: string;
          created_at?: string;
          did?: string;
          display_name?: string | null;
          email?: string | null;
          handle?: string | null;
          passkey_enrolled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      claim_pot_activity_lease: {
        Args: {
          p_chain_id: number;
          p_contract_address: string;
          p_lease_seconds: number;
          p_owner: string;
        };
        Returns: boolean;
      };
      current_did: { Args: never; Returns: string };
      release_pot_activity_lease: {
        Args: { p_chain_id: number; p_contract_address: string; p_owner: string };
        Returns: boolean;
      };
    };
    Enums: {
      behaviour_subject:
        | "commitment_goal"
        | "accountability_pool"
        | "savings_goal";
      behaviour_metric: "steps" | "screen_time_minutes";
      payment_kind: "direct" | "claimable";
      payment_status:
        | "pending"
        | "held"
        | "confirmed"
        | "reclaimed"
        | "disputed"
        | "resolved_recipient"
        | "resolved_sender"
        | "claimed"
        | "expired";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];

export type Row<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type Insert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type Update<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Enum<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T];
