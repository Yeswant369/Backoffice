"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles } from "@/lib/auth";
import { OPERATIONAL_ROLES } from "@/lib/roles";
import { resolveLocationSheet } from "@/lib/google/location";
import {
  ensureTab,
  getSheetsClient,
  listTabTitles,
  readGrid,
  writeGrid,
} from "@/lib/google/sheets";

export interface CountState {
  error?: string;
  success?: string;
  flagged?: number;
}

const STOCK_TAB = "Stock Count";
const HEADERS = ["Date", "Department", "Item", "Unit", "System Qty", "PAR", "Actual Qty"];
const VARIANCE_THRESHOLD = 0.3; // ±30% flags a "massive" variance

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const istToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function locationId(supabase: ServerClient): Promise<string | null> {
  const { data } = await supabase.from("locations").select("id").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function requireRole() {
  const { user, roles } = await getCurrentUserAndRoles();
  // Stock counting is a WRITE action — exclude read-only cross-outlet roles (5/6).
  if (!user || !roles.some((r) => OPERATIONAL_ROLES.includes(r))) return null;
  return user;
}

export interface CountItemInput {
  rawMaterialId: string;
  actualQty: number;
}

/** Record a physical stock count for a department → stock_counts (TvA actual). */
export async function submitStockCount(
  departmentId: number,
  items: CountItemInput[],
): Promise<CountState> {
  const user = await requireRole();
  if (!user) return { error: "You are not authorized to submit counts." };
  if (!departmentId) return { error: "Select a department." };

  const entered = items.filter((i) => i.rawMaterialId && Number.isFinite(i.actualQty));
  if (entered.length === 0) return { error: "Enter at least one count." };

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const matIds = entered.map((i) => i.rawMaterialId);
  // System (theoretical) qty + par are re-derived server-side; never trust client.
  const { data: stock } = await supabase
    .from("live_stock")
    .select("raw_material_id, current_stock, par_level")
    .eq("department_id", departmentId)
    .in("raw_material_id", matIds);
  const sysByMat = new Map(
    (stock ?? []).map((s) => [
      s.raw_material_id,
      { qty: Number(s.current_stock), par: Number(s.par_level) },
    ]),
  );
  const { data: mats } = await supabase
    .from("raw_materials")
    .select("id, par_level")
    .in("id", matIds);
  const parById = new Map((mats ?? []).map((m) => [m.id, Number(m.par_level)]));

  const today = istToday();
  let flagged = 0;
  const rows = entered.map((i) => {
    const s = sysByMat.get(i.rawMaterialId);
    const system_qty = s?.qty ?? 0;
    const par_level = s?.par ?? parById.get(i.rawMaterialId) ?? 0;
    const actual_qty = Number(i.actualQty) || 0;
    if (system_qty > 0 && Math.abs(actual_qty - system_qty) / system_qty > VARIANCE_THRESHOLD)
      flagged += 1;
    return {
      location_id: loc,
      department_id: departmentId,
      raw_material_id: i.rawMaterialId,
      count_date: today,
      system_qty,
      actual_qty,
      par_level,
    };
  });

  const { error } = await supabase
    .from("stock_counts")
    .upsert(rows, { onConflict: "location_id,department_id,raw_material_id,count_date" });
  if (error) return { error: error.message };

  // Self-correcting: post a VARIANCE_RECONCILIATION per material so live_stock
  // converges to the physical count instead of drifting forever. Positive delta
  // (counted more than system) credits the dept (to_department); negative debits
  // it (from_department); quantity is the magnitude. Variance is measured
  // against the re-derived system qty, so re-counting the same day stays
  // convergent (an unchanged count posts ~0).
  const adjustments = rows
    .map((r) => {
      const delta = r.actual_qty - r.system_qty;
      if (Math.abs(delta) < 1e-9) return null;
      return delta > 0
        ? {
            location_id: loc,
            raw_material_id: r.raw_material_id,
            from_department_id: null,
            to_department_id: departmentId,
            type: "VARIANCE_RECONCILIATION",
            quantity: delta,
          }
        : {
            location_id: loc,
            raw_material_id: r.raw_material_id,
            from_department_id: departmentId,
            to_department_id: null,
            type: "VARIANCE_RECONCILIATION",
            quantity: -delta,
          };
    })
    .filter(Boolean) as Record<string, unknown>[];
  if (adjustments.length > 0) {
    const { error: adjErr } = await supabase
      .from("inventory_ledger")
      .insert(adjustments);
    if (adjErr)
      return { error: `Counts saved, but stock reconciliation failed: ${adjErr.message}` };
  }

  revalidatePath("/dashboard/admin/inventory/count");
  revalidatePath("/dashboard/admin/analytics/variance");
  revalidatePath("/dashboard/admin/inventory/live-stock");
  return {
    success: `Saved ${rows.length} count${rows.length === 1 ? "" : "s"} and reconciled stock to match.`,
    flagged,
  };
}

export interface TemplateItem {
  name: string;
  unit: string;
  system: number;
  par: number;
}

/** Push a fillable count template to the sheet so managers can count on an iPad. */
export async function pushStockTemplate(
  departmentName: string,
  items: TemplateItem[],
): Promise<CountState> {
  const user = await requireRole();
  if (!user) return { error: "Not authorized." };

  const supabase = await createClient();
  const sheet = await resolveLocationSheet(supabase);
  if (!sheet) return { error: "No Google Sheet configured. Connect one in Settings." };

  const today = istToday();
  const rows = items.map((it) => [
    today,
    departmentName,
    it.name,
    it.unit,
    String(it.system),
    String(it.par),
    "", // Actual Qty — manager fills this
  ]);

  try {
    const sheets = getSheetsClient();
    const existing = await listTabTitles(sheets, sheet.spreadsheetId);
    await ensureTab(sheets, sheet.spreadsheetId, STOCK_TAB, existing);
    await writeGrid(sheets, sheet.spreadsheetId, STOCK_TAB, [HEADERS, ...rows]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to push template." };
  }
  return { success: `Pushed ${rows.length} items to the "${STOCK_TAB}" tab.` };
}

/** PULL: read the manager-filled count from the sheet, diff, write stock_counts. */
export async function pullStockCount(
  fallbackDeptId: number,
): Promise<CountState> {
  const user = await requireRole();
  if (!user) return { error: "Not authorized." };

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };
  const sheet = await resolveLocationSheet(supabase);
  if (!sheet) return { error: "No Google Sheet configured. Connect one in Settings." };

  let grid: string[][];
  try {
    const sheets = getSheetsClient();
    grid = await readGrid(sheets, sheet.spreadsheetId, STOCK_TAB);
  } catch {
    return { error: `Tab "${STOCK_TAB}" not found. Push the template first.` };
  }
  if (grid.length < 2) return { error: `No rows in the "${STOCK_TAB}" tab.` };

  const header = grid[0].map((h) => (h ?? "").toString().trim().toLowerCase());
  const itemI = header.findIndex((h) => h === "item" || h === "material" || h.includes("item"));
  const actualI = header.findIndex((h) => h.includes("actual"));
  const deptI = header.findIndex((h) => h.includes("department") || h.includes("dept"));
  if (itemI < 0 || actualI < 0)
    return { error: 'The sheet needs "Item" and "Actual Qty" columns.' };

  const [{ data: mats }, { data: depts }, { data: stock }] = await Promise.all([
    supabase.from("raw_materials").select("id, name, par_level"),
    supabase.from("departments").select("id, name"),
    supabase.from("live_stock").select("raw_material_id, department_id, current_stock, par_level"),
  ]);
  const matByName = new Map(
    (mats ?? []).map((m) => [norm(m.name), { id: m.id as string, par: Number(m.par_level) }]),
  );
  const deptByName = new Map((depts ?? []).map((d) => [norm(d.name), d.id as number]));
  const sysByKey = new Map(
    (stock ?? []).map((s) => [
      `${s.department_id}:${s.raw_material_id}`,
      { qty: Number(s.current_stock), par: Number(s.par_level) },
    ]),
  );

  const today = istToday();
  const rows: {
    location_id: string;
    department_id: number;
    raw_material_id: string;
    count_date: string;
    system_qty: number;
    actual_qty: number;
    par_level: number;
  }[] = [];
  let unmatched = 0;

  for (const row of grid.slice(1)) {
    const itemName = (row[itemI] ?? "").toString().trim();
    const actualRaw = (row[actualI] ?? "").toString().trim();
    if (!itemName || actualRaw === "") continue;
    const mat = matByName.get(norm(itemName));
    if (!mat) {
      unmatched += 1;
      continue;
    }
    const deptId =
      deptI >= 0
        ? (deptByName.get(norm((row[deptI] ?? "").toString())) ?? fallbackDeptId)
        : fallbackDeptId;
    const sys = sysByKey.get(`${deptId}:${mat.id}`);
    rows.push({
      location_id: loc,
      department_id: deptId,
      raw_material_id: mat.id,
      count_date: today,
      system_qty: sys?.qty ?? 0,
      actual_qty: Number(actualRaw.replace(/[^0-9.\-]/g, "")) || 0,
      par_level: sys?.par ?? mat.par,
    });
  }

  if (rows.length === 0)
    return { error: `No matching items with an Actual Qty${unmatched ? ` (${unmatched} unmatched)` : ""}.` };

  const { error } = await supabase
    .from("stock_counts")
    .upsert(rows, { onConflict: "location_id,department_id,raw_material_id,count_date" });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/inventory/count");
  revalidatePath("/dashboard/admin/analytics/variance");
  return {
    success: `Pulled ${rows.length} count${rows.length === 1 ? "" : "s"} from the sheet${unmatched ? ` · ${unmatched} unmatched` : ""}.`,
  };
}
