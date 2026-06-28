"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mapAndReplay, type MapState } from "./actions";

export default function MapUnmappedRow({
  posItemCode,
  recipes,
}: {
  posItemCode: string | null;
  recipes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [recipeId, setRecipeId] = useState("");
  const [state, setState] = useState<MapState | null>(null);
  const [pending, start] = useTransition();

  if (!posItemCode) return <span className="text-xs text-neutral-400">no code</span>;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        value={recipeId}
        onChange={(e) => setRecipeId(e.target.value)}
        className="rounded-md border border-[#d9d1c1] bg-white px-2 py-1 text-xs text-neutral-700"
      >
        <option value="">Map to recipe…</option>
        {recipes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
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
