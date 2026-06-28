"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export interface ProductionState {
  error?: string;
  success?: string;
  token?: string;
}

const numField = (fd: FormData, k: string) => Number(fd.get(k) ?? 0);

/**
 * Record a day's kitchen production for one item in one department:
 * prepared / sold / wasted (prepared-ITEM wastage). Upserts on
 * (location, department, recipe, date) so corrections during the day overwrite.
 */
export async function recordProduction(
  _prev: ProductionState | undefined,
  fd: FormData,
): Promise<ProductionState> {
  if (!(await isAdmin())) return { error: "Only administrators can record production." };

  const recipe_id = String(fd.get("recipe_id") ?? "");
  const department_id = Math.floor(numField(fd, "department_id"));
  const production_date = String(fd.get("production_date") ?? "").trim();
  const prepared_qty = numField(fd, "prepared_qty");
  const sold_qty = numField(fd, "sold_qty");
  const wastage_qty = numField(fd, "wastage_qty");

  if (!recipe_id) return { error: "Select a dish." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(production_date)) {
    return { error: "Select a valid date." };
  }
  if (prepared_qty < 0 || sold_qty < 0 || wastage_qty < 0) {
    return { error: "Quantities cannot be negative." };
  }

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? null;
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Re-validate the recipe belongs to this location, and read its department.
  const { data: rec } = await supabase
    .from("recipes")
    .select("id, department_id")
    .eq("id", recipe_id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!rec) return { error: "Recipe not found in your location." };

  // The dish's OWN department wins, so production lands in the same bucket as its
  // sales (department_pl stays internally consistent). The picked department is
  // only a fallback for dishes with no department assigned yet.
  const recDept = (rec as { department_id: number | null }).department_id;
  const effectiveDept = recDept ?? (department_id || null);
  if (!effectiveDept) {
    return { error: "This dish has no department — assign one in Recipe Builder, or pick a department here." };
  }
  if (!recDept) {
    const { data: dep } = await supabase
      .from("departments")
      .select("id")
      .eq("id", effectiveDept)
      .eq("location_id", loc)
      .maybeSingle();
    if (!dep) return { error: "Department not found in your location." };
  }

  const { error } = await supabase.from("kitchen_production").upsert(
    {
      location_id: loc,
      department_id: effectiveDept,
      recipe_id,
      production_date,
      prepared_qty,
      sold_qty,
      wastage_qty,
    },
    { onConflict: "location_id,department_id,recipe_id,production_date" },
  );
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/kitchen-production");
  return { success: "Production recorded.", token: crypto.randomUUID() };
}
