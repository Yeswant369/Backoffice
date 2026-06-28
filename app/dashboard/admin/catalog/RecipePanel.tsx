"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/format";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import { FormFeedback, type Feedback } from "../../_components/forms";
import { createRecipe, deleteRecipe, type CatalogState } from "./actions";
import DeleteButton from "./DeleteButton";
import RecipeForm from "./RecipeForm";
import RecipesWorkspace from "./RecipesWorkspace";
import SyncBar from "./SyncBar";
import type { MaterialOption, RecipeRow } from "./types";

interface Props {
  recipes: RecipeRow[];
  materials: MaterialOption[];
  departments: { id: number; name: string }[];
  sheetUrl: string;
  connected: boolean;
}

export default function RecipePanel({
  recipes,
  materials,
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

  return (
    <div className="space-y-6">
      <RecipesWorkspace connected={connected} sheetUrl={sheetUrl} />

      <SyncBar sheetUrl={sheetUrl} />

      {/* `key` changes on each successful create (new token) → form resets. */}
      <RecipeForm
        key={state?.token ?? "init"}
        materials={materials}
        departments={departments}
        formAction={formAction}
        pending={pending}
      />
      <FormFeedback feedback={feedback} />

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Recipes <span className="ml-1 text-neutral-500">{recipes.length}</span>
          </h3>
        </div>
        {recipes.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No recipes yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-2.5 font-medium">Recipe</th>
                <th className="px-5 py-2.5 font-medium">Category</th>
                <th className="px-5 py-2.5 text-right font-medium">Ingredients</th>
                <th className="px-5 py-2.5 text-right font-medium">Yield</th>
                <th className="px-5 py-2.5 text-right font-medium">Price</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((r) => (
                <tr key={r.id} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-2.5 font-medium text-neutral-900">{r.name}</td>
                  <td className="px-5 py-2.5 text-neutral-600">
                    {r.category ?? "—"}
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
