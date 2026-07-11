import { createClient } from "@/lib/supabase/server";
import SectionHeader from "../_components/SectionHeader";
import IndentRequestForm from "../_components/IndentRequestForm";
import KitchenDashboard from "./KitchenDashboard";
import type { LiveStockRow, RawMaterialOption, RecipeOption } from "./types";

export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  const supabase = await createClient();

  // Pin to HOME — RLS read-scope can span outlets for hybrid users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

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
        "id, code, name, brand, purchase_unit, stock_unit, conversion_factor, vendor_id, category",
      )
      .eq("location_id", loc)
      .order("name"),
    supabase.from("departments").select("id, name").eq("location_id", loc),
  ]);

  const stock = (stockRes.data ?? []) as LiveStockRow[];
  const recipes = (recipesRes.data ?? []) as unknown as RecipeOption[];
  const materials = (materialsRes.data ?? []) as RawMaterialOption[];
  const departments = (deptRes.data ?? []) as { id: number; name: string }[];

  // No numeric fallback — a wrong guess would post to another department.
  // When unresolved, IndentRequestForm falls back to its department select.
  const kitchenDeptId = departments.find(
    (d) => d.name.trim().toLowerCase() === "kitchen",
  )?.id;

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
        kitchenDeptId={kitchenDeptId ?? -1}
      />

      <div className="mt-8">
        <IndentRequestForm
          departments={departments}
          materials={materials.map((m) => ({
            id: m.id,
            name: m.name,
            code: m.code,
            stock_unit: m.stock_unit,
          }))}
          fixedDepartmentId={kitchenDeptId}
        />
      </div>
    </div>
  );
}
