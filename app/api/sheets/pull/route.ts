import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getSheetsClient, listTabTitles, readTab } from "@/lib/google/sheets";
import { resolveLocationSheet } from "@/lib/google/location";
import {
  isRecipeCostingTab,
  parseTab,
  type ParsedRecipe,
} from "@/lib/google/recipe-matrix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Loose match key: lowercase, alphanumerics only (ignores spaces/hyphens/case). */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    autoCreate?: boolean;
  };
  const autoCreate = Boolean(body.autoCreate);

  const supabase = await createClient();

  // Resolve THIS user's location → its Google Sheet (RLS-scoped, tenant-safe).
  const loc = await resolveLocationSheet(supabase);
  if (!loc) {
    return NextResponse.json(
      { error: "No Google Sheet is configured for your location." },
      { status: 400 },
    );
  }

  const [recipeRes, matRes] = await Promise.all([
    supabase.from("recipes").select("id, name"),
    supabase.from("raw_materials").select("id, name"),
  ]);

  if (recipeRes.error || matRes.error) {
    return NextResponse.json(
      { error: recipeRes.error?.message ?? matRes.error?.message },
      { status: 500 },
    );
  }

  const recipeIdByKey = new Map(
    (recipeRes.data ?? []).map((r) => [key(r.name), r.id]),
  );
  const materialIdByKey = new Map(
    (matRes.data ?? []).map((m) => [key(m.name), m.id]),
  );

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = loc.spreadsheetId;
    const tabs = await listTabTitles(sheets, spreadsheetId);

    // Collect parsed dishes together with the tab (= category) they came from.
    // Only genuine recipe-costing tabs are read — Instructions / Index / Dish
    // Summary / Master tabs are skipped so their text rows never become recipes.
    const dishes: { tab: string; parsed: ParsedRecipe }[] = [];
    const skippedTabs: string[] = [];
    for (const tab of tabs) {
      const rows = await readTab(sheets, spreadsheetId, tab);
      if (!isRecipeCostingTab(tab, rows)) {
        skippedTabs.push(tab);
        continue;
      }
      for (const parsed of parseTab(rows)) {
        if (parsed.name.trim()) dishes.push({ tab, parsed });
      }
    }

    const ingredientUpserts = new Map<
      string,
      {
        recipe_id: string;
        raw_material_id: string;
        quantity_needed: number;
        location_id: string;
      }
    >();
    const unmatchedMaterials = new Set<string>();
    let createdRecipes = 0;
    let createdMaterials = 0;

    for (const { tab, parsed } of dishes) {
      let recipeId = recipeIdByKey.get(key(parsed.name));

      // Create the recipe if it only exists in the sheet (e.g. "Brocolli").
      // Existing recipes' price/yield are NOT overwritten — the app is the
      // source of truth for those (pull syncs ingredient quantities only).
      if (!recipeId) {
        const { data, error } = await supabase
          .from("recipes")
          .insert({
            name: parsed.name,
            category: tab,
            location_id: loc.locationId,
            selling_price: parsed.sellingPrice ?? 0,
            yield_portions:
              parsed.yieldPortions && parsed.yieldPortions > 0
                ? Math.round(parsed.yieldPortions)
                : 1,
            overhead_percentage:
              parsed.overheadPercentage && parsed.overheadPercentage >= 0
                ? parsed.overheadPercentage
                : 0,
          })
          .select("id")
          .single();
        if (error || !data) {
          return NextResponse.json(
            { error: `Failed to create recipe "${parsed.name}": ${error?.message}` },
            { status: 500 },
          );
        }
        recipeId = data.id;
        recipeIdByKey.set(key(parsed.name), recipeId);
        createdRecipes += 1;
      }

      for (const ing of parsed.ingredients) {
        let materialId = materialIdByKey.get(key(ing.material));

        // Auto-create a stub material (flagged for review) when enabled.
        if (!materialId && autoCreate) {
          const { data: created, error } = await supabase
            .from("raw_materials")
            .insert({
              name: ing.material,
              location_id: loc.locationId,
              purchase_unit: "unit",
              stock_unit: "unit",
              conversion_factor: 1,
              par_level: 0,
              needs_review: true,
            })
            .select("id")
            .single();
          if (!error && created) {
            materialId = created.id;
            materialIdByKey.set(key(ing.material), materialId);
            createdMaterials += 1;
          }
        }

        if (!materialId) {
          unmatchedMaterials.add(ing.material);
          continue;
        }
        ingredientUpserts.set(`${recipeId}:${materialId}`, {
          recipe_id: recipeId,
          raw_material_id: materialId,
          quantity_needed: ing.quantity,
          location_id: loc.locationId,
        });
      }
    }

    const upserts = [...ingredientUpserts.values()];
    if (upserts.length > 0) {
      const { error } = await supabase
        .from("recipe_ingredients")
        .upsert(upserts, { onConflict: "recipe_id,raw_material_id" });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    revalidatePath("/dashboard/admin/catalog");

    return NextResponse.json({
      dishes: dishes.length,
      createdRecipes,
      createdMaterials,
      updatedIngredients: upserts.length,
      unmatchedMaterials: [...unmatchedMaterials],
      skippedTabs,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to pull from Google Sheets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
