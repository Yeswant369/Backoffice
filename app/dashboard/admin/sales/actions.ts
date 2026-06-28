"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export interface SaleState {
  error?: string;
  success?: string;
  token?: string;
}

/**
 * Record a manual (non-POS) sale → inserts into manual_sales_log, whose trigger
 * explodes the recipe and deducts ingredients from the Kitchen. Pinned to and
 * re-validated against the caller's home location.
 */
export async function recordManualSale(
  _prev: SaleState | undefined,
  fd: FormData,
): Promise<SaleState> {
  if (!(await isAdmin())) return { error: "Only administrators can record sales." };

  const recipe_id = String(fd.get("recipe_id") ?? "");
  const quantity_sold = Math.floor(Number(fd.get("quantity_sold") ?? 0));
  const sale_date = String(fd.get("sale_date") ?? "").trim();

  if (!recipe_id) return { error: "Select a dish." };
  if (!(quantity_sold > 0)) return { error: "Quantity must be at least 1." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sale_date)) {
    return { error: "Select a valid sale date." };
  }

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? null;
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Re-validate the recipe belongs to this location.
  const { data: rec } = await supabase
    .from("recipes")
    .select("id")
    .eq("id", recipe_id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!rec) return { error: "Recipe not found in your location." };

  const { error } = await supabase.from("manual_sales_log").insert({
    recipe_id,
    quantity_sold,
    sale_date,
    location_id: loc,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/sales");
  revalidatePath("/dashboard/admin/inventory/live-stock");
  return {
    success: `Logged ${quantity_sold} sale${quantity_sold === 1 ? "" : "s"} — Kitchen stock deducted.`,
    token: crypto.randomUUID(),
  };
}
