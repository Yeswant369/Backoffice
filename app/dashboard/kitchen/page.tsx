import { createClient } from "@/lib/supabase/server";
import SectionHeader from "../_components/SectionHeader";
import KitchenDashboard from "./KitchenDashboard";
import type { LiveStockRow, RawMaterialOption, RecipeOption } from "./types";

export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  const supabase = await createClient();

  const [stockRes, recipesRes, materialsRes, deptRes] = await Promise.all([
    supabase.from("live_stock").select("*").order("raw_material_name"),
    supabase
      .from("recipes")
      .select(
        "id, name, selling_price, recipe_ingredients!recipe_id ( quantity_needed, raw_materials ( id, name, stock_unit ) )",
      )
      .order("name"),
    supabase
      .from("raw_materials")
      .select(
        "id, name, brand, purchase_unit, stock_unit, conversion_factor, vendor_id, category",
      )
      .order("name"),
    supabase.from("departments").select("id, name"),
  ]);

  const stock = (stockRes.data ?? []) as LiveStockRow[];
  const recipes = (recipesRes.data ?? []) as unknown as RecipeOption[];
  const materials = (materialsRes.data ?? []) as RawMaterialOption[];
  const departments = (deptRes.data ?? []) as { id: number; name: string }[];

  const kitchenDeptId =
    departments.find((d) => d.name.toLowerCase() === "kitchen")?.id ?? 2;

  const loadError =
    stockRes.error || recipesRes.error || materialsRes.error || deptRes.error;

  return (
    <div>
      <SectionHeader
        eyebrow="Kitchen"
        title="Production Floor"
        description="Simulate dish sales to auto-deduct recipe ingredients, and log wastage for spoiled stock. Kitchen stock updates live."
      />

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}. Confirm the Phase 1
          migration (tables, views &amp; grants) has been applied.
        </p>
      )}

      <KitchenDashboard
        initialStock={stock}
        recipes={recipes}
        materials={materials}
        kitchenDeptId={kitchenDeptId}
      />
    </div>
  );
}
