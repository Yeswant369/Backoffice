import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import SectionHeader from "../../../_components/SectionHeader";
import MetricCard from "../../../_components/MetricCard";
import RecipeEditor from "./RecipeEditor";
import type { RecipeFormInitial } from "../../catalog/RecipeForm";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface IngredientJoin {
  raw_material_id: string | null;
  sub_recipe_id: string | null;
  quantity_needed: number;
  notes: string | null;
}

/** Recipe profile: identity + live costing chain + full editor. */
export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();

  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";
  if (!loc) notFound();

  const [recipeRes, ingRes, matRes, wacRes, costingRes, deptRes, cuisineRes] =
    await Promise.all([
      supabase
        .from("recipes")
        .select(
          "id, name, category, course, video_url, pos_item_code, department_id, selling_price, yield_portions, overhead_percentage",
        )
        .eq("id", id)
        .eq("location_id", loc)
        .maybeSingle(),
      supabase
        .from("recipe_ingredients")
        .select("raw_material_id, sub_recipe_id, quantity_needed, notes")
        .eq("recipe_id", id)
        .order("id"), // deterministic row order in the editor
      supabase
        .from("raw_materials")
        .select("id, name, code, brand, stock_unit")
        .eq("location_id", loc)
        .order("name"),
      supabase
        .from("weighted_average_cost")
        .select("raw_material_id, weighted_avg_cost")
        .eq("location_id", loc),
      supabase
        .from("recipe_costing")
        .select("recipe_id, recipe_name, cogs, margin_value, food_cost_pct")
        .eq("location_id", loc),
      supabase
        .from("departments")
        .select("id, name")
        .eq("location_id", loc)
        .order("name"),
      // Managed cuisine list → datalist suggestions in the edit form.
      supabase
        .from("categories")
        .select("name")
        .eq("location_id", loc)
        .eq("kind", "cuisine")
        .order("name"),
    ]);

  if (!recipeRes.data) notFound();
  const recipe = recipeRes.data;

  const wacById = new Map(
    (wacRes.data ?? []).map((w) => [w.raw_material_id as string, n(w.weighted_avg_cost)]),
  );
  const materials = (matRes.data ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    code: (m.code as string | null) ?? null,
    stock_unit: m.stock_unit as string,
    brand: (m.brand as string | null) ?? null,
    weighted_avg_cost: wacById.get(m.id as string) ?? 0,
  }));

  // Sub-recipe options = every OTHER recipe, priced at its plate cost.
  const costingRows = costingRes.data ?? [];
  const subRecipes = costingRows
    .filter((c) => c.recipe_id !== id)
    .map((c) => ({
      id: c.recipe_id as string,
      name: (c.recipe_name as string) ?? "—",
      unit_cost: n(c.cogs),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const myCosting = costingRows.find((c) => c.recipe_id === id);

  const initial: RecipeFormInitial = {
    recipeId: recipe.id as string,
    name: recipe.name as string,
    category: (recipe.category as string | null) ?? "",
    course: (recipe.course as string | null) ?? "",
    departmentId:
      recipe.department_id != null ? String(recipe.department_id) : "",
    sellingPrice: String(n(recipe.selling_price)),
    yieldPortions: String(n(recipe.yield_portions) || 1),
    overhead: String(n(recipe.overhead_percentage)),
    posItemCode: (recipe.pos_item_code as string | null) ?? "",
    videoUrl: (recipe.video_url as string | null) ?? "",
    rows: ((ingRes.data ?? []) as IngredientJoin[]).map((r) => ({
      materialId: r.raw_material_id,
      subRecipeId: r.sub_recipe_id,
      qty: String(n(r.quantity_needed)),
      notes: r.notes ?? "",
    })),
  };

  const plateCost = n(myCosting?.cogs);
  const marginValue = n(myCosting?.margin_value);
  const foodCostPct = n(myCosting?.food_cost_pct);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link
          href="/dashboard/admin/catalog?tab=recipes"
          className="transition hover:text-neutral-900"
        >
          Recipe Builder
        </Link>
        <span>/</span>
        <span className="text-neutral-700">{recipe.name}</span>
      </div>

      <SectionHeader
        eyebrow={[recipe.category, recipe.course].filter(Boolean).join(" · ") || "Recipe"}
        title={recipe.name as string}
        description={[
          recipe.pos_item_code && `POS ${recipe.pos_item_code}`,
          `${n(recipe.yield_portions) || 1} portion yield`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Plate cost" value={inr(plateCost)} sub="incl. overhead" />
        <MetricCard label="Selling price" value={inr(n(recipe.selling_price))} />
        <MetricCard
          label="Margin"
          value={inr(marginValue)}
          tone={marginValue < 0 ? "negative" : "positive"}
        />
        <MetricCard
          label="Food cost %"
          value={n(recipe.selling_price) > 0 ? `${foodCostPct.toFixed(1)}%` : "—"}
          tone={foodCostPct > 45 ? "negative" : foodCostPct > 35 ? "default" : "positive"}
        />
      </div>

      {recipe.video_url && (
        <p className="mb-6 text-sm">
          <a
            href={recipe.video_url as string}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-indigo-700 underline transition hover:text-indigo-500"
          >
            ▶ Technique video
          </a>
        </p>
      )}

      <RecipeEditor
        materials={materials}
        subRecipes={subRecipes}
        departments={(deptRes.data ?? []) as { id: number; name: string }[]}
        cuisines={(cuisineRes.data ?? []).map((c) => c.name as string)}
        initial={initial}
      />
    </div>
  );
}
