"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/format";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import { FormFeedback, type Feedback } from "../../_components/forms";
import { createRecipe, deleteRecipe, type CatalogState } from "./actions";
import DeleteButton from "./DeleteButton";
import RecipeForm, { type SubRecipeOption } from "./RecipeForm";
import RecipesWorkspace from "./RecipesWorkspace";
import SyncBar from "./SyncBar";
import type { MaterialOption, RecipeRow } from "./types";

interface Props {
  recipes: RecipeRow[];
  materials: MaterialOption[];
  subRecipes: SubRecipeOption[];
  departments: { id: number; name: string }[];
  sheetUrl: string;
  connected: boolean;
}

export default function RecipePanel({
  recipes,
  materials,
  subRecipes,
  departments,
  sheetUrl,
  connected,
}: Props) {
  const [state, formAction, pending] = useActionState<
    CatalogState | undefined,
    FormData
  >(createRecipe, undefined);

  const router = useRouter();
  const syncedToken = useRef<string | undefined>(undefined);

  // On a successful save (new token), mirror to the "Recipes" Google Sheet tab —
  // the same trigger-on-success pattern the Purchase Log uses.
  useEffect(() => {
    const token = state?.token;
    if (token && token !== syncedToken.current) {
      syncedToken.current = token;
      void triggerSheetSync().finally(() => router.refresh());
    }
  }, [state?.token, router]);

  const feedback: Feedback | null = state?.error
    ? { type: "error", message: state.error }
    : state?.success
      ? { type: "success", message: state.success }
      : null;

  // ── Cuisine (category) tabs + course sub-tabs, pure client-side filters. ──
  const [cuisine, setCuisine] = useState<string>("All");
  const [course, setCourse] = useState<string>("All");

  const cuisineOf = (r: RecipeRow) => r.category ?? "Uncategorised";
  const courseOf = (r: RecipeRow) => r.course ?? "—";

  const cuisines = useMemo(
    () => ["All", ...[...new Set(recipes.map(cuisineOf))].sort()],
    [recipes],
  );

  // A selected tab can vanish after router.refresh() (recipe deleted/renamed) —
  // fall back to "All" instead of filtering everything to an empty list.
  const effectiveCuisine = cuisines.includes(cuisine) ? cuisine : "All";

  const cuisineRows = useMemo(
    () =>
      effectiveCuisine === "All"
        ? recipes
        : recipes.filter((r) => cuisineOf(r) === effectiveCuisine),
    [recipes, effectiveCuisine],
  );

  const courses = useMemo(
    () => ["All", ...[...new Set(cuisineRows.map(courseOf))].sort()],
    [cuisineRows],
  );

  const effectiveCourse = courses.includes(course) ? course : "All";

  const filtered = useMemo(
    () =>
      effectiveCourse === "All"
        ? cuisineRows
        : cuisineRows.filter((r) => courseOf(r) === effectiveCourse),
    [cuisineRows, effectiveCourse],
  );

  return (
    <div className="space-y-6">
      <RecipesWorkspace connected={connected} sheetUrl={sheetUrl} />

      <SyncBar sheetUrl={sheetUrl} />

      {/* `key` changes on each successful create (new token) → form resets. */}
      <RecipeForm
        key={state?.token ?? "init"}
        materials={materials}
        subRecipes={subRecipes}
        departments={departments}
        formAction={formAction}
        pending={pending}
      />
      <FormFeedback feedback={feedback} />

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="space-y-2 border-b border-[#e6e0d3] px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Recipes{" "}
            <span className="ml-1 text-neutral-500">
              {filtered.length === recipes.length
                ? recipes.length
                : `${filtered.length} / ${recipes.length}`}
            </span>
          </h3>

          {/* Cuisine tabs */}
          <div className="flex flex-wrap gap-1 rounded-lg bg-[#efe9dd] p-1">
            {cuisines.map((c) => {
              const active = effectiveCuisine === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCuisine(c);
                    setCourse("All");
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "bg-white text-neutral-950 shadow-sm"
                      : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>

          {/* Course sub-tabs (within the active cuisine) */}
          <div className="flex flex-wrap gap-1 rounded-lg bg-[#efe9dd] p-1">
            {courses.map((c) => {
              const active = effectiveCourse === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCourse(c)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "bg-white text-neutral-950 shadow-sm"
                      : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            {recipes.length === 0 ? "No recipes yet." : "No recipes match this filter."}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-2.5 font-medium">Recipe</th>
                <th className="px-5 py-2.5 font-medium">Category</th>
                <th className="px-5 py-2.5 font-medium">Course</th>
                <th className="px-5 py-2.5 font-medium">POS code</th>
                <th className="px-5 py-2.5 text-right font-medium">Ingredients</th>
                <th className="px-5 py-2.5 text-right font-medium">Yield</th>
                <th className="px-5 py-2.5 text-right font-medium">Price</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-2.5 font-medium">
                    <Link
                      href={`/dashboard/admin/recipes/${r.id}`}
                      className="text-indigo-700 transition hover:text-indigo-500"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-5 py-2.5 text-neutral-600">
                    {r.category ?? "—"}
                  </td>
                  <td className="px-5 py-2.5 text-neutral-600">
                    {r.course ?? "—"}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-neutral-600">
                    {r.pos_item_code ?? "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
                    {r.ingredient_count}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
                    {r.yield_portions}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                    {inr(r.selling_price)}
                  </td>
                  <td className="px-5 py-2.5">
                    <DeleteButton
                      id={r.id}
                      action={deleteRecipe}
                      confirmMessage={`Delete recipe "${r.name}"?`}
                      syncOnSuccess
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
