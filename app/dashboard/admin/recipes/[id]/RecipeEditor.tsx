"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import { FormFeedback, type Feedback } from "../../../_components/forms";
import { updateRecipe, type CatalogState } from "../../catalog/actions";
import RecipeForm, {
  type RecipeFormInitial,
  type SubRecipeOption,
} from "../../catalog/RecipeForm";
import type { MaterialOption } from "../../catalog/types";

/** Edit surface for one recipe — RecipeForm in edit mode + save feedback. */
export default function RecipeEditor({
  materials,
  subRecipes,
  departments,
  cuisines,
  initial,
}: {
  materials: MaterialOption[];
  subRecipes: SubRecipeOption[];
  departments: { id: number; name: string }[];
  /** Managed cuisine names (categories kind=cuisine) for the datalist. */
  cuisines?: string[];
  initial: RecipeFormInitial;
}) {
  const [state, formAction, pending] = useActionState<
    CatalogState | undefined,
    FormData
  >(updateRecipe, undefined);
  const router = useRouter();
  const syncedToken = useRef<string | undefined>(undefined);

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
    <div className="space-y-4">
      <RecipeForm
        materials={materials}
        subRecipes={subRecipes}
        departments={departments}
        cuisines={cuisines}
        formAction={formAction}
        pending={pending}
        initial={initial}
      />
      <FormFeedback feedback={feedback} />
    </div>
  );
}
