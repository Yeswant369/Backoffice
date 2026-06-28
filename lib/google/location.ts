import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LocationSheet {
  locationId: string;
  spreadsheetId: string;
}

/**
 * Resolve the caller's location and its Google Sheet id.
 *
 * Uses the session-bound Supabase client, so RLS on `locations` guarantees only
 * the caller's OWN location is visible — there is no way to read another
 * tenant's spreadsheet id. Returns null when the location has no sheet
 * configured (the route surfaces a clear 400).
 */
export async function resolveLocationSheet(
  supabase: SupabaseClient,
): Promise<LocationSheet | null> {
  // Pin to the caller's HOME location explicitly. For hybrid roles (e.g.
  // Admin+Owner) RLS read-scope spans the whole org, so a bare limit(1) could
  // pick an ARBITRARY outlet's sheet and bleed every outlet's data into it.
  const { data: homeId } = await supabase.rpc("current_location_id");
  if (!homeId) return null;

  const { data, error } = await supabase
    .from("locations")
    .select("id, google_spreadsheet_id")
    .eq("id", homeId as string)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.google_spreadsheet_id) return null;

  return { locationId: data.id as string, spreadsheetId: data.google_spreadsheet_id as string };
}

/**
 * Resolve a specific sheet for the caller's location by purpose
 * (e.g. "recipes", "vendors", "sales") from the location_sheets registry.
 * RLS scopes the lookup to the caller's own location. Falls back to the legacy
 * locations.google_spreadsheet_id for the "recipes" purpose.
 */
export async function resolveSheetByPurpose(
  supabase: SupabaseClient,
  purpose: string,
): Promise<LocationSheet | null> {
  const { data, error } = await supabase
    .from("location_sheets")
    .select("location_id, google_spreadsheet_id")
    .eq("purpose", purpose)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data?.google_spreadsheet_id) {
    return {
      locationId: data.location_id as string,
      spreadsheetId: data.google_spreadsheet_id as string,
    };
  }

  // Fall back to the single location workspace sheet (configured in Settings)
  // for every purpose — tabs differentiate the data, not separate spreadsheets.
  return resolveLocationSheet(supabase);
}
