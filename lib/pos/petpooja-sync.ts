import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPetpoojaOrders, type PetpoojaCreds } from "./petpooja";
import { ingestPetpoojaOrders } from "./petpooja-pull";

/** Today (IST) shifted by offsetDays, as YYYY-MM-DD. */
export function istDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

/** Inclusive list of YYYY-MM-DD dates from `from` to `to` (capped for safety). */
export function datesBetween(from: string, to: string, cap = 120): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${to}T00:00:00+05:30`);
  while (cur <= end && out.length < cap) {
    out.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export interface SyncSummary {
  days: number;
  orders: number;
  depleted: number;
  unmapped: number;
  errors: string[];
}

/**
 * Pull + ingest a set of dates for one location, then stamp pos_last_synced_at.
 * Per-day failures are collected (not thrown) so one bad day doesn't abort the
 * rest. Requires a service-role client.
 */
export async function syncLocationPos(
  admin: SupabaseClient,
  location: { id: string; petpooja_rest_id: string },
  dates: string[],
  creds: PetpoojaCreds,
): Promise<SyncSummary> {
  let orders = 0;
  let depleted = 0;
  let unmapped = 0;
  const errors: string[] = [];

  for (const date of dates) {
    try {
      const raw = await fetchPetpoojaOrders(location.petpooja_rest_id, date, creds);
      const res = await ingestPetpoojaOrders(admin, location.id, raw);
      orders += res.orders;
      depleted += res.depleted;
      unmapped += res.unmapped;
    } catch (e) {
      errors.push(`${date}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  await admin
    .from("locations")
    .update({ pos_last_synced_at: new Date().toISOString() })
    .eq("id", location.id);

  return { days: dates.length, orders, depleted, unmapped, errors };
}
