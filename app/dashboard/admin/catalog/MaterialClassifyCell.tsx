"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMaterialClassification } from "./actions";
import type { CategoryOption } from "./types";

const selectCls =
  "rounded-md border border-[#e6e0d3] bg-white px-2 py-1 text-xs text-neutral-700 transition focus:border-neutral-400 focus:outline-none disabled:opacity-60";

/**
 * Inline type + category editors for one material row. Submits onChange via a
 * transition (no form) and refreshes the server-rendered table on success.
 */
export default function MaterialClassifyCell({
  materialId,
  materialType,
  categoryId,
  categories,
}: {
  materialId: string;
  materialType: string;
  categoryId: string | null;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState(
    materialType === "OPERATIONAL" ? "OPERATIONAL" : "INGREDIENT",
  );
  const [catId, setCatId] = useState(categoryId ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(nextType: string, nextCatId: string) {
    startTransition(async () => {
      const res = await updateMaterialClassification(
        materialId,
        nextType,
        nextCatId,
      );
      if (res.error) {
        setError(res.error);
        alert(res.error);
      } else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <div
      className="flex items-center gap-1.5"
      title={error ?? undefined}
    >
      <select
        value={type}
        disabled={pending}
        onChange={(e) => {
          setType(e.target.value);
          submit(e.target.value, catId);
        }}
        className={`${selectCls} ${error ? "border-red-400 text-red-600" : ""}`}
      >
        <option value="INGREDIENT">Ingredient</option>
        <option value="OPERATIONAL">Operational</option>
      </select>
      <select
        value={catId}
        disabled={pending}
        onChange={(e) => {
          setCatId(e.target.value);
          submit(type, e.target.value);
        }}
        className={`${selectCls} ${error ? "border-red-400 text-red-600" : ""}`}
      >
        <option value="">— none —</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
