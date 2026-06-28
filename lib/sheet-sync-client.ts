/**
 * Fire-and-report the unified Google Sheets sync (/api/sheets/push) from the
 * client after a form submission succeeds. Per the architecture rule, every
 * successful create/log/issue must mirror to the location's sheet.
 *
 * Single-flight per browser tab: concurrent calls coalesce onto the in-flight
 * sync, and one trailing re-run fires afterwards so the latest save is always
 * reflected. This keeps a burst of saves from launching overlapping syncs that
 * would race on the same spreadsheet. (Cross-client serialization still needs a
 * server-side lock — see the data-flow notes.)
 */
let inFlight: Promise<{ ok: boolean; error?: string }> | null = null;
let pendingRerun = false;

async function runSync(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/sheets/push", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? "Sheet sync failed." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Sheet sync request failed." };
  }
}

export async function triggerSheetSync(): Promise<{ ok: boolean; error?: string }> {
  if (inFlight) {
    pendingRerun = true; // a save landed mid-sync — schedule one follow-up
    return inFlight;
  }
  inFlight = runSync();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
    if (pendingRerun) {
      pendingRerun = false;
      void triggerSheetSync();
    }
  }
}
