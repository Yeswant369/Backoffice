import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSheetsClient,
  listTabTitles,
  ensureTab,
  appendRows,
  readGrid,
  writeGrid,
} from "@/lib/google/sheets";

const SALES_DEPLETION_HEADERS = [
  "Date",
  "Item Name",
  "Department",
  "Qty",
  "Unit",
];

const fmtDate = (s: unknown) => (s ? String(s).slice(0, 10) : "");

interface DepletionRow {
  created_at: string;
  quantity: number;
  from_department_id: number | null;
  raw_materials: { name: string; stock_unit: string } | null;
}

/**
 * Append-only mirror of SALES_DEPLETION ledger rows into a 'Sales Depletion'
 * tab on the tenant's sheet. Uses the SERVICE ROLE client (RLS-bypassing), so
 * every query is filtered by location_id EXPLICITLY. Append-by-count keeps it
 * idempotent across repeated webhook calls (mirrors p2p-sync.appendByCount).
 */
export async function mirrorSalesDepletion(
  admin: SupabaseClient,
  locationId: string,
): Promise<void> {
  const { data: locRow } = await admin
    .from("locations")
    .select("google_spreadsheet_id")
    .eq("id", locationId)
    .maybeSingle();
  const sid = locRow?.google_spreadsheet_id as string | undefined;
  if (!sid) return; // sheet not configured -> nothing to mirror

  const [ledgerRes, deptRes] = await Promise.all([
    admin
      .from("inventory_ledger")
      .select(
        "created_at, quantity, from_department_id, raw_materials ( name, stock_unit )",
      )
      .eq("location_id", locationId)
      .eq("type", "SALES_DEPLETION")
      .order("created_at", { ascending: true }),
    admin.from("departments").select("id, name").eq("location_id", locationId),
  ]);

  const deptName = new Map(
    (deptRes.data ?? []).map((d) => [d.id as number, d.name as string]),
  );
  const rows = ((ledgerRes.data ?? []) as unknown as DepletionRow[]).map((r) => [
    fmtDate(r.created_at),
    r.raw_materials?.name ?? "",
    r.from_department_id ? (deptName.get(r.from_department_id) ?? "") : "",
    String(Number(r.quantity ?? 0)),
    r.raw_materials?.stock_unit ?? "",
  ]);

  const sheets = getSheetsClient();
  const existing = await listTabTitles(sheets, sid);
  await ensureTab(sheets, sid, "Sales Depletion", existing);
  const grid = await readGrid(sheets, sid, "Sales Depletion");
  if (grid.length === 0) {
    await writeGrid(sheets, sid, "Sales Depletion", [SALES_DEPLETION_HEADERS, ...rows]);
    return;
  }
  const have = Math.max(0, grid.length - 1);
  const missing = rows.slice(have);
  if (missing.length) await appendRows(sheets, sid, "Sales Depletion", missing);
}
