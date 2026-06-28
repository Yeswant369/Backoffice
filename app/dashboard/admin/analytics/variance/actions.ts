"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { explodeSale, type RecipeNode } from "@/lib/pos/explosion";

export interface MapState {
  error?: string;
  success?: string;
}

const num = (v: unknown) => Number(v ?? 0);

interface IngredientRow {
  raw_material_id: string | null;
  sub_recipe_id: string | null;
  quantity_needed: number;
}
interface RecipeRow {
  id: string;
  pos_item_code: string | null;
  yield_portions: number;
  recipe_ingredients: IngredientRow[];
}
interface UnmappedRow {
  id: string;
  quantity: number;
  order_id: string | null;
  line_no: number | null;
}

/**
 * Map an unmatched POS code to a recipe AND replay the queued sales into stock —
 * closing the "silent shrinkage" hole (an unmapped sale otherwise depletes
 * nothing, so theoretical stock silently overstates reality).
 *
 *   1. set recipes.pos_item_code = code  → future sales auto-deplete
 *   2. for every queued unmapped_sale with that code: explode the recipe ×
 *      quantity → post SALES_DEPLETION (source_ref `replay:<unmapped id>`, so it
 *      can't collide with the order's already-posted lines) + a pos_sales fact
 *   3. mark those unmapped rows resolved
 *
 * Pinned to the caller's home location (NOT RLS read-scope, which spans the org
 * for hybrid roles) and idempotent (resolved filter + upsert-ignore-duplicates).
 */
export async function mapAndReplay(
  posItemCode: string,
  recipeId: string,
): Promise<MapState> {
  if (!(await isAdmin())) return { error: "Only administrators can map sales." };
  if (!posItemCode || !recipeId) {
    return { error: "Pick a recipe to map this code to." };
  }

  const supabase = await createClient();

  // Pin to the caller's HOME location explicitly. RLS read-scope spans the whole
  // org for hybrid Admin+Owner users, so an unfiltered .maybeSingle() would error
  // (multi-row) or resolve the wrong outlet.
  const { data: homeId } = await supabase.rpc("current_location_id");
  const locationId = (homeId as string | null) ?? undefined;
  if (!locationId) return { error: "Your account isn't assigned to a location." };

  const { data: kitchen } = await supabase
    .from("departments")
    .select("id")
    .eq("location_id", locationId)
    .ilike("name", "kitchen")
    .maybeSingle();
  if (!kitchen) return { error: "No 'Kitchen' department configured for this location." };
  const kitchenId = kitchen.id as number;

  // 1. Map the code so future POS sales auto-resolve. Location-scoped; the
  //    returned rows confirm the recipe really belongs to this location.
  const { data: mapped, error: mapErr } = await supabase
    .from("recipes")
    .update({ pos_item_code: posItemCode })
    .eq("id", recipeId)
    .eq("location_id", locationId)
    .select("id");
  if (mapErr) {
    const friendly =
      (mapErr as { code?: string }).code === "23505"
        ? "That POS code is already mapped to another recipe."
        : `Couldn't map code: ${mapErr.message}`;
    return { error: friendly };
  }
  if (!mapped || mapped.length === 0) {
    return { error: "Recipe not found in your location." };
  }

  // 2. Load the recipe graph (pinned to this location) for explosion.
  const { data: recipeRows, error: recErr } = await supabase
    .from("recipes")
    .select(
      "id, pos_item_code, yield_portions, recipe_ingredients!recipe_id ( raw_material_id, sub_recipe_id, quantity_needed )",
    )
    .eq("location_id", locationId);
  if (recErr) return { error: recErr.message };
  const byId = new Map<string, RecipeNode>();
  for (const r of (recipeRows ?? []) as unknown as RecipeRow[]) {
    byId.set(r.id, {
      id: r.id,
      yieldPortions: num(r.yield_portions) || 1,
      ingredients: (r.recipe_ingredients ?? []).map((ri) => ({
        rawMaterialId: ri.raw_material_id ?? null,
        subRecipeId: ri.sub_recipe_id ?? null,
        quantityNeeded: num(ri.quantity_needed),
      })),
    });
  }
  const target = byId.get(recipeId);
  if (!target) return { error: "Recipe not found in your location." };

  // 3. Queued unmapped sales for this code.
  const { data: queue } = await supabase
    .from("unmapped_sales")
    .select("id, quantity, order_id, line_no")
    .eq("location_id", locationId)
    .eq("pos_item_code", posItemCode)
    .eq("resolved", false);
  const rows = (queue ?? []) as UnmappedRow[];
  if (rows.length === 0) {
    return {
      success: `Mapped — future "${posItemCode}" sales will deplete stock automatically (no queued sales to replay).`,
    };
  }

  // 4. Replay each queued sale. A line whose recipe fails to explode (cyclic /
  //    over-deep) is left FULLY in the triage queue — no pos_sales fact, not
  //    resolved — so it is never silently dropped.
  const ledgerRows: Record<string, unknown>[] = [];
  const posSalesRows: Record<string, unknown>[] = [];
  const resolvedIds: string[] = [];
  let failed = 0;
  for (const u of rows) {
    const consumed = new Map<string, number>();
    try {
      explodeSale(target, num(u.quantity), byId, consumed);
    } catch {
      failed++;
      continue;
    }
    for (const [rawMaterialId, qty] of consumed.entries()) {
      if (qty > 0) {
        ledgerRows.push({
          location_id: locationId,
          raw_material_id: rawMaterialId,
          from_department_id: kitchenId,
          to_department_id: null,
          type: "SALES_DEPLETION",
          quantity: Number(qty.toFixed(4)),
          source_ref: `replay:${u.id}`,
        });
      }
    }
    posSalesRows.push({
      location_id: locationId,
      recipe_id: recipeId,
      quantity: num(u.quantity),
      pos_item_code: posItemCode,
      order_id: u.order_id,
      line_no: u.line_no,
    });
    resolvedIds.push(u.id);
  }

  if (ledgerRows.length > 0) {
    const { error } = await supabase
      .from("inventory_ledger")
      .upsert(ledgerRows, {
        onConflict: "location_id,source_ref,raw_material_id",
        ignoreDuplicates: true,
      });
    if (error) return { error: `Stock replay failed: ${error.message}` };
  }
  if (posSalesRows.length > 0) {
    const { error } = await supabase
      .from("pos_sales")
      .upsert(posSalesRows, {
        onConflict: "location_id,order_id,line_no",
        ignoreDuplicates: true,
      });
    if (error) {
      return { error: `Recorded stock, but the sales fact failed: ${error.message}` };
    }
  }

  // 5. Resolve only the rows that actually replayed.
  if (resolvedIds.length > 0) {
    const { error } = await supabase
      .from("unmapped_sales")
      .update({ resolved: true })
      .in("id", resolvedIds);
    if (error) {
      return { error: `Replayed, but couldn't clear the triage queue: ${error.message}` };
    }
  }

  revalidatePath("/dashboard/admin/analytics/variance");
  revalidatePath("/dashboard/admin/inventory/live-stock");
  const ok = resolvedIds.length;
  let msg = `Mapped "${posItemCode}"`;
  if (ok > 0) msg += ` and replayed ${ok} sale${ok === 1 ? "" : "s"} into stock`;
  if (failed > 0) msg += `${ok > 0 ? "; " : " — "}${failed} skipped (recipe explosion error)`;
  return { success: `${msg}.` };
}
