"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export interface SettingsState {
  error?: string;
  success?: string;
}

/**
 * Extract a Google Spreadsheet ID from a pasted URL or a bare id.
 * Sheet IDs are long [A-Za-z0-9-_] tokens (typically 44 chars).
 */
function extractSpreadsheetId(input: string): string | null {
  const raw = input.trim();
  // From a URL: .../spreadsheets/d/<ID>/edit
  const urlMatch = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  // A bare id pasted directly.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;
  return null;
}

/** Save the location's workspace spreadsheet id (the "Day One" connect step). */
export async function connectWorkspaceSheet(
  _prev: SettingsState | undefined,
  fd: FormData,
): Promise<SettingsState> {
  if (!(await isAdmin())) {
    return { error: "Only administrators can configure the workspace." };
  }

  const id = extractSpreadsheetId(String(fd.get("sheet_url") ?? ""));
  if (!id) {
    return {
      error: "Couldn't find a spreadsheet ID. Paste the full Google Sheet URL.",
    };
  }

  const supabase = await createClient();
  const { data: loc } = await supabase.from("locations").select("id").maybeSingle();
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const { error } = await supabase
    .from("locations")
    .update({ google_spreadsheet_id: id })
    .eq("id", loc.id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/settings", "layout");
  return { success: "Workspace connected." };
}
