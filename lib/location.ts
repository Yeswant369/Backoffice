import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Active-outlet selection for cross-outlet roles (Owner / Area Manager).
 *
 * RLS already scopes every read to the caller's visible locations (home for
 * roles 1-4; assigned/org for 5/6). This module layers a UI "focus": the
 * location switcher writes a cookie, and pages read getActiveLocation() to
 * decide whether to show ALL visible outlets ("all") or one specific outlet.
 *
 * Safety: the cookie is always validated against the RLS-visible set, so a
 * tampered cookie can never widen access — at worst it falls back to "all".
 */
export const ACTIVE_LOCATION_COOKIE = "active_location";

export interface VisibleLocation {
  id: string;
  name: string;
}

/** Locations the caller can SEE (RLS-scoped). One row for roles 1-4. */
export async function getVisibleLocations(
  supabase: SupabaseClient,
): Promise<VisibleLocation[]> {
  const { data } = await supabase
    .from("locations")
    .select("id, name")
    .order("name", { ascending: true });
  return (data ?? []).map((l) => ({
    id: l.id as string,
    name: (l.name as string) ?? "Outlet",
  }));
}

export interface ActiveLocation {
  /** The focused outlet id, or null for "All outlets" (multi-location only). */
  activeId: string | null;
  /** Every outlet the caller can see — drives the switcher. */
  locations: VisibleLocation[];
}

/**
 * Resolve the focused outlet. Single-location users (roles 1-4) always get
 * their one location. Multi-location users get the cookie's outlet when it is
 * still visible to them, otherwise null ("All outlets").
 */
export async function getActiveLocation(
  supabase: SupabaseClient,
): Promise<ActiveLocation> {
  const locations = await getVisibleLocations(supabase);
  if (locations.length <= 1) {
    return { activeId: locations[0]?.id ?? null, locations };
  }
  const store = await cookies();
  const raw = store.get(ACTIVE_LOCATION_COOKIE)?.value;
  if (raw && raw !== "all" && locations.some((l) => l.id === raw)) {
    return { activeId: raw, locations };
  }
  return { activeId: null, locations };
}
