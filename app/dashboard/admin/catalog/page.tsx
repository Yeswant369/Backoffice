import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import SectionHeader from "../../_components/SectionHeader";
import CatalogManager from "./CatalogManager";
import type { CategoryOption, MaterialRow, RecipeRow, VendorRow } from "./types";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const sp = await searchParams;
  const initialTab = sp.tab === "recipes" ? "recipes" : "materials";
  const title =
    initialTab === "recipes" ? "Recipe Builder" : "Raw Materials Catalog";
  const description =
    initialTab === "recipes"
      ? "Build dishes and sub-recipes — ingredient costs and margins compute automatically."
      : "Create and manage the raw materials the rest of the system depends on.";

  const supabase = await createClient();
  // Pin EVERYTHING to HOME — RLS read-scope spans the org for hybrid
  // Admin+Owner users; an unpinned catalog would list (and offer in pickers)
  // other outlets' vendors/materials/recipes.
  const { data: homeLoc } = await supabase.rpc("current_location_id");
  const home = (homeLoc as string | null) ?? "";

  const [
    vendorRes,
    matRes,
    recipeRes,
    wacRes,
    costingRes,
    locRes,
    deptRes,
    catRes,
  ] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        "id, vendor_code, name, contact_person, phone, email, bank_name, account_number, ifsc_code, status",
      )
      .eq("location_id", home)
      .order("name"),
    supabase
      .from("raw_materials")
      .select(
        "id, name, code, brand, purchase_unit, stock_unit, conversion_factor, par_level, material_type, category, category_id, vendor_id, needs_review, vendors ( name )",
      )
      .eq("location_id", home)
      .order("name"),
    supabase
      .from("recipes")
      .select(
        "id, name, selling_price, yield_portions, overhead_percentage, category, course, pos_item_code, recipe_ingredients!recipe_id ( count )",
      )
      .eq("location_id", home)
      .order("name"),
    supabase
      .from("weighted_average_cost")
      .select("raw_material_id, weighted_avg_cost")
      .eq("location_id", home),
    // Plate cost per recipe — powers sub-recipe line pricing in the builder.
    supabase
      .from("recipe_costing")
      .select("recipe_id, cogs")
      .eq("location_id", home),
    // The caller's own (home) location → its Google Sheet id.
    supabase
      .from("locations")
      .select("google_spreadsheet_id")
      .eq("id", home)
      .maybeSingle(),
    supabase
      .from("departments")
      .select("id, name")
      .eq("location_id", home)
      .order("name"),
    supabase
      .from("categories")
      .select("id, kind, name")
      .eq("location_id", home)
      .order("name"),
  ]);

  const allCategories = (catRes.data ?? []) as {
    id: string;
    kind: string;
    name: string;
  }[];
  const byKind = (kind: string): CategoryOption[] =>
    allCategories
      .filter((c) => c.kind === kind)
      .map((c) => ({ id: c.id, name: c.name }));
  const materialCategories = byKind("material");
  const vendorCategories = byKind("vendor");
  const cuisineCategories = byKind("cuisine");

  const departments = (deptRes.data ?? []) as { id: number; name: string }[];

  // Single location workspace sheet (configured once in Settings).
  const spreadsheetId = locRes.data?.google_spreadsheet_id ?? null;
  const connected = Boolean(spreadsheetId);
  const sheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    : "";

  const vendors = (vendorRes.data ?? []) as VendorRow[];

  const wacByMaterial = new Map<string, number>();
  for (const row of wacRes.data ?? []) {
    wacByMaterial.set(row.raw_material_id, Number(row.weighted_avg_cost ?? 0));
  }

  const materials: MaterialRow[] = (matRes.data ?? []).map((m) => {
    const vendor = m.vendors as unknown as { name: string } | null;
    return {
      id: m.id,
      name: m.name,
      code: m.code ?? null,
      brand: m.brand,
      purchase_unit: m.purchase_unit,
      stock_unit: m.stock_unit,
      conversion_factor: Number(m.conversion_factor),
      par_level: Number(m.par_level),
      material_type: (m.material_type as string) ?? "INGREDIENT",
      category: m.category,
      category_id: (m.category_id as string | null) ?? null,
      vendor_id: m.vendor_id,
      vendor_name: vendor?.name ?? null,
      weighted_avg_cost: wacByMaterial.get(m.id) ?? 0,
      needs_review: Boolean(m.needs_review),
    };
  });

  const recipes: RecipeRow[] = (recipeRes.data ?? []).map((r) => {
    // PostgREST returns an aggregate relation as [{ count: n }].
    const agg = r.recipe_ingredients as unknown as { count: number }[];
    return {
      id: r.id,
      name: r.name,
      selling_price: Number(r.selling_price),
      ingredient_count: agg?.[0]?.count ?? 0,
      category: r.category,
      course: r.course ?? null,
      pos_item_code: r.pos_item_code ?? null,
      yield_portions: Number(r.yield_portions ?? 1),
      overhead_percentage: Number(r.overhead_percentage ?? 0),
    };
  });

  const loadError =
    vendorRes.error || matRes.error || recipeRes.error || wacRes.error;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <span>Master Data</span>
        <span>/</span>
        <span className="text-neutral-700">{title}</span>
      </div>

      <SectionHeader eyebrow="Master Data" title={title} description={description} />

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}.
        </p>
      )}

      <CatalogManager
        key={initialTab}
        initialTab={initialTab}
        vendors={vendors}
        materials={materials}
        recipes={recipes}
        recipeUnitCosts={Object.fromEntries(
          (costingRes.data ?? []).map((c) => [c.recipe_id as string, Number(c.cogs ?? 0)]),
        )}
        departments={departments}
        materialCategories={materialCategories}
        vendorCategories={vendorCategories}
        cuisineCategories={cuisineCategories}
        sheetUrl={sheetUrl}
        connected={connected}
      />
    </div>
  );
}
