"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Combobox from "../../../_components/Combobox";
import { mapAndReplay, type MapState } from "./actions";

export default function MapUnmappedRow({
  posItemCode,
  recipes,
}: {
  posItemCode: string | null;
  recipes: { id: string; name: string; selling_price: number }[];
}) {
  const router = useRouter();
  const [recipeId, setRecipeId] = useState("");
  const [state, setState] = useState<MapState | null>(null);
  const [pending, start] = useTransition();

  if (!posItemCode) return <span className="text-xs text-neutral-400">no code</span>;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="min-w-[180px]">
        <Combobox
          name="recipe_id"
          placeholder="Map to recipe…"
          value={recipeId}
          onChange={setRecipeId}
          options={recipes.map((r) => ({
            id: r.id,
            label: r.name,
            hint: `₹${r.selling_price}`,
          }))}
        />
      </div>
      <button
        type="button"
        disabled={!recipeId || pending}
        onClick={() =>
          start(async () => {
            const res = await mapAndReplay(posItemCode, recipeId);
            setState(res);
            if (res.success) router.refresh();
          })
        }
        className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "Replaying…" : "Map & replay"}
      </button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </div>
  );
}
