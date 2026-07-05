import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { sheets_v4 } from "googleapis";
import { appendRows, ensureTab, readGrid, writeGrid } from "./sheets";

const fmtDate = (s: unknown) => (s ? String(s).slice(0, 10) : "");
const n = (v: unknown) => Number(v ?? 0);

interface JoinedMaterial {
  name: string;
  stock_unit: string;
}
interface PurchaseRow {
  created_at: string;
  transaction_date: string | null;
  quantity: number;
  unit_price: number | null;
  raw_materials: JoinedMaterial | null;
  vendors: { name: string } | null;
  purchase_bills: { invoice_no: string | null } | null;
}
interface TransferRow {
  created_at: string;
  quantity: number;
  from_department_id: number | null;
  to_department_id: number | null;
  raw_materials: JoinedMaterial | null;
  created_by: string | null;
}

/**
 * Ensure a tab exists with headers, then APPEND only rows that aren't already
 * there (matched by row count). Existing rows are normally never overwritten —
 * EXCEPT when the header SHAPE changed (e.g. the Bill No column was added):
 * appending wider rows under an old narrower header would permanently misalign
 * every new row, so a header mismatch triggers a one-time full rewrite from the
 * DB (the ledger is the source of truth; rows regenerate losslessly).
 */
async function appendByCount(
  sheets: sheets_v4.Sheets,
  sid: string,
  title: string,
  headers: string[],
  allRows: string[][],
  existing: string[],
): Promise<number> {
  await ensureTab(sheets, sid, title, existing);
  const grid = await readGrid(sheets, sid, title);
  if (grid.length === 0) {
    await writeGrid(sheets, sid, title, [headers, ...allRows]);
    return allRows.length;
  }
  const currentHeader = (grid[0] ?? []).map((c) => String(c ?? "").trim());
  const headerMatches =
    currentHeader.length === headers.length &&
    headers.every((h, i) => currentHeader[i] === h);
  if (!headerMatches) {
    // Schema migration: rewrite the whole tab in the new shape.
    await writeGrid(sheets, sid, title, [headers, ...allRows]);
    return allRows.length;
  }
  const have = Math.max(0, grid.length - 1); // minus header row
  const missing = allRows.slice(have);
  if (missing.length) await appendRows(sheets, sid, title, missing);
  return missing.length;
}

function buildSummary(purchases: PurchaseRow[]): string[][] {
  const byMonth = new Map<string, { total: number; vendors: Map<string, number> }>();
  for (const p of purchases) {
    // Bucket spend by the invoice (transaction) date, not the logging date.
    const month = String(p.transaction_date ?? p.created_at).slice(0, 7);
    const spend = n(p.quantity) * n(p.unit_price);
    const vendor = p.vendors?.name ?? "—";
    const e = byMonth.get(month) ?? { total: 0, vendors: new Map() };
    e.total += spend;
    e.vendors.set(vendor, (e.vendors.get(vendor) ?? 0) + spend);
    byMonth.set(month, e);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, e]) => {
      const top =
        [...e.vendors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
      return [month, e.total.toFixed(2), top];
    });
}

const PURCHASE_HEADERS = [
  "Date", "Bill No", "Vendor Name", "Material Name", "Qty", "Unit", "Unit Price", "Line Total",
];
const SUMMARY_HEADERS = ["Month", "Total Spend", "Top Vendor"];
const ISSUE_HEADERS = [
  "Date", "Item Name", "Issued From", "Issued To", "Qty", "Unit", "Issued By",
];

/** Mirror procurement + dynamic department issue tabs into the location sheet. */
export async function syncProcurementTabs(
  supabase: SupabaseClient,
  sheets: sheets_v4.Sheets,
  sid: string,
  existing: string[],
  locationId: string,
): Promise<{ purchases: number; issueTabs: string[] }> {
  // Every read is pinned to the caller's HOME location — NOT RLS read-scope,
  // which spans the whole org for hybrid Admin+Owner users (would bleed all
  // outlets' procurement into one sheet). Vendors now sync via "Vendor Master".
  const [purchasesRes, transfersRes, deptRes, profRes] =
    await Promise.all([
      supabase
        .from("inventory_ledger")
        .select(
          "created_at, transaction_date, quantity, unit_price, raw_materials ( name, stock_unit ), vendors ( name ), purchase_bills ( invoice_no )",
        )
        .eq("type", "PURCHASE")
        .eq("location_id", locationId)
        // Order by created_at (insertion order) — NOT transaction_date — so the
        // append-by-count stays stable even when invoices are backdated.
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("inventory_ledger")
        .select(
          "created_at, quantity, from_department_id, to_department_id, created_by, raw_materials ( name, stock_unit )",
        )
        .in("type", ["INTER_DEPARTMENT_TRANSFER", "ISSUE_TO_KITCHEN"])
        .eq("location_id", locationId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase.from("departments").select("id, name").eq("location_id", locationId),
      supabase.from("profiles").select("id, full_name").eq("location_id", locationId),
    ]);

  const deptName = new Map(
    (deptRes.data ?? []).map((d) => [d.id, d.name as string]),
  );
  const userName = new Map(
    (profRes.data ?? []).map((p) => [p.id, (p.full_name as string) ?? ""]),
  );

  // Purchase Log
  const purchases = (purchasesRes.data ?? []) as unknown as PurchaseRow[];
  const purchaseRows = purchases.map((p) => {
    const qty = n(p.quantity);
    const price = n(p.unit_price);
    return [
      fmtDate(p.transaction_date ?? p.created_at),
      p.purchase_bills?.invoice_no ?? "",
      p.vendors?.name ?? "",
      p.raw_materials?.name ?? "",
      String(qty),
      p.raw_materials?.stock_unit ?? "",
      price.toFixed(2),
      (qty * price).toFixed(2),
    ];
  });
  const purchasesSynced = await appendByCount(
    sheets, sid, "Purchase Log", PURCHASE_HEADERS, purchaseRows, existing,
  );

  // Procurement Summary (derived → full rewrite, no manual data)
  await ensureTab(sheets, sid, "Procurement Summary", existing);
  await writeGrid(sheets, sid, "Procurement Summary", [
    SUMMARY_HEADERS, ...buildSummary(purchases),
  ]);

  // Dynamic Issues - [Department]
  const transfers = (transfersRes.data ?? []) as unknown as TransferRow[];
  const byDept = new Map<string, string[][]>();
  for (const t of transfers) {
    const to = t.to_department_id ? (deptName.get(t.to_department_id) ?? "Unassigned") : "Unassigned";
    const from = t.from_department_id ? (deptName.get(t.from_department_id) ?? "") : "";
    const row = [
      fmtDate(t.created_at),
      t.raw_materials?.name ?? "",
      from,
      to,
      String(n(t.quantity)),
      t.raw_materials?.stock_unit ?? "",
      t.created_by ? (userName.get(t.created_by) ?? "") : "",
    ];
    const arr = byDept.get(to) ?? [];
    arr.push(row);
    byDept.set(to, arr);
  }

  const issueTabs: string[] = [];
  for (const [dept, rows] of byDept) {
    const title = `Issues - ${dept}`;
    await appendByCount(sheets, sid, title, ISSUE_HEADERS, rows, existing);
    issueTabs.push(title);
  }

  return { purchases: purchasesSynced, issueTabs };
}
