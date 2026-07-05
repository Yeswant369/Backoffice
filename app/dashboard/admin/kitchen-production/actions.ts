"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export interface ProductionState {
  error?: string;
  success?: string;
  token?: string;
}

interface SheetRow {
  recipe_id: string;
  prepared_qty: number;
  staff_meals_qty: number;
  wastage_qty: number;
  closing_qty: number | null;
  wastage_photo_path: string | null;
}

interface SubSheetRow {
  recipe_id: string;
  made_qty: number;
  waste_qty: number;
  closing_qty: number | null;
  waste_photo_path: string | null;
}

const IST_TODAY = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

function parseDay(fd: FormData): string | { error: string } {
  const d = String(fd.get("production_date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "Select a valid date." };
  if (d > IST_TODAY()) return { error: "Production date cannot be in the future." };
  if (d < "2000-01-01") return { error: "Production date looks wrong." };
  return d;
}

const qtyOk = (v: number) => Number.isFinite(v) && v >= 0 && v < 1e10;

/** Validate a storage photo path (uploaded by the browser to wastage-photos). */
const photoOk = (p: unknown, loc: string): p is string | null =>
  p === null || (typeof p === "string" && p.startsWith(`${loc}/`) && !p.includes(".."));

/**
 * Save the DISH worksheet for one department + date: every row upserts on
 * (location, department, recipe, date). Rows with all-zero inputs and no
 * existing record are skipped by the client; the server validates the rest.
 */
export async function saveProductionSheet(
  _prev: ProductionState | undefined,
  fd: FormData,
): Promise<ProductionState> {
  if (!(await isAdmin())) return { error: "Only administrators can record production." };

  const day = parseDay(fd);
  if (typeof day !== "string") return day;
  const department_id = Math.floor(Number(fd.get("department_id") ?? 0));
  if (!department_id) return { error: "Pick a department." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(fd.get("rows") ?? "[]"));
  } catch {
    return { error: "Invalid worksheet rows." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "Nothing to save." };
  if (parsed.length > 300) return { error: "Too many rows." };

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? null;
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const { data: dep } = await supabase
    .from("departments")
    .select("id")
    .eq("id", department_id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!dep) return { error: "Department not found in your location." };

  const rows: SheetRow[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") return { error: "Invalid worksheet rows." };
    const r = raw as Record<string, unknown>;
    const recipe_id = typeof r.recipe_id === "string" ? r.recipe_id : "";
    const prepared = Number(r.prepared_qty);
    const staff = Number(r.staff_meals_qty);
    const waste = Number(r.wastage_qty);
    const closing = r.closing_qty === null || r.closing_qty === "" ? null : Number(r.closing_qty);
    if (!recipe_id) return { error: "A row is missing its dish." };
    if (!qtyOk(prepared) || !qtyOk(staff) || !qtyOk(waste) || (closing !== null && !qtyOk(closing))) {
      return { error: "Quantities must be non-negative numbers." };
    }
    if (!photoOk(r.wastage_photo_path ?? null, loc)) {
      return { error: "Invalid photo reference — retake the photo and try again." };
    }
    rows.push({
      recipe_id,
      prepared_qty: prepared,
      staff_meals_qty: staff,
      wastage_qty: waste,
      closing_qty: closing,
      wastage_photo_path: (r.wastage_photo_path as string | null) ?? null,
    });
  }

  // Every recipe must belong to this outlet AND this department.
  const ids = [...new Set(rows.map((r) => r.recipe_id))];
  if (ids.length !== rows.length) return { error: "Duplicate dish rows." };
  const { data: recs } = await supabase
    .from("recipes")
    .select("id")
    .in("id", ids)
    .eq("location_id", loc)
    .eq("department_id", department_id);
  if ((recs ?? []).length !== ids.length) {
    return { error: "One or more dishes weren't found in this department." };
  }

  const { error } = await supabase.from("kitchen_production").upsert(
    rows.map((r) => ({
      location_id: loc,
      department_id,
      recipe_id: r.recipe_id,
      production_date: day,
      prepared_qty: r.prepared_qty,
      // sold_qty deliberately OMITTED: the view auto-derives sold from sales,
      // and sending 0 would stomp legacy hand-typed values on re-save.
      wastage_qty: r.wastage_qty,
      staff_meals_qty: r.staff_meals_qty,
      closing_qty: r.closing_qty,
      wastage_photo_path: r.wastage_photo_path,
    })),
    { onConflict: "location_id,department_id,recipe_id,production_date" },
  );
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/kitchen-production");
  return { success: `Saved ${rows.length} dish row(s).`, token: crypto.randomUUID() };
}

/**
 * Save the SUB-RECIPE day ledger for one date: made / waste / closing per
 * sub-recipe (opening, available, used and variance derive in sub_recipe_daily).
 */
export async function saveSubProductionSheet(
  _prev: ProductionState | undefined,
  fd: FormData,
): Promise<ProductionState> {
  if (!(await isAdmin())) return { error: "Only administrators can record production." };

  const day = parseDay(fd);
  if (typeof day !== "string") return day;

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(fd.get("rows") ?? "[]"));
  } catch {
    return { error: "Invalid worksheet rows." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "Nothing to save." };
  if (parsed.length > 300) return { error: "Too many rows." };

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? null;
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const rows: SubSheetRow[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") return { error: "Invalid worksheet rows." };
    const r = raw as Record<string, unknown>;
    const recipe_id = typeof r.recipe_id === "string" ? r.recipe_id : "";
    const made = Number(r.made_qty);
    const waste = Number(r.waste_qty);
    const closing = r.closing_qty === null || r.closing_qty === "" ? null : Number(r.closing_qty);
    if (!recipe_id) return { error: "A row is missing its sub-recipe." };
    if (!qtyOk(made) || !qtyOk(waste) || (closing !== null && !qtyOk(closing))) {
      return { error: "Quantities must be non-negative numbers." };
    }
    if (!photoOk(r.waste_photo_path ?? null, loc)) {
      return { error: "Invalid photo reference — retake the photo and try again." };
    }
    rows.push({
      recipe_id,
      made_qty: made,
      waste_qty: waste,
      closing_qty: closing,
      waste_photo_path: (r.waste_photo_path as string | null) ?? null,
    });
  }

  const ids = [...new Set(rows.map((r) => r.recipe_id))];
  if (ids.length !== rows.length) return { error: "Duplicate sub-recipe rows." };
  const { data: recs } = await supabase
    .from("recipes")
    .select("id")
    .in("id", ids)
    .eq("location_id", loc);
  if ((recs ?? []).length !== ids.length) {
    return { error: "One or more sub-recipes weren't found in your location." };
  }

  const { error } = await supabase.from("sub_recipe_production").upsert(
    rows.map((r) => ({
      location_id: loc,
      recipe_id: r.recipe_id,
      production_date: day,
      made_qty: r.made_qty,
      waste_qty: r.waste_qty,
      closing_qty: r.closing_qty,
      waste_photo_path: r.waste_photo_path,
    })),
    { onConflict: "location_id,recipe_id,production_date" },
  );
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/kitchen-production");
  return { success: `Saved ${rows.length} sub-recipe row(s).`, token: crypto.randomUUID() };
}
