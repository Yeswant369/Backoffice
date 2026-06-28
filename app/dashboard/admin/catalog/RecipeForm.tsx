"use client";

import { useMemo, useRef, useState } from "react";
import { inr } from "@/lib/format";
import { computeCosting } from "@/lib/google/recipe-matrix";
import {
  Field,
  SubmitButton,
  inputCls,
  labelCls,
} from "../../_components/forms";
import type { MaterialOption } from "./types";

const CUISINES = [
  "South Indian",
  "North Indian",
  "Chinese",
  "Continental",
  "Beverages",
  "Desserts",
];

interface Row {
  key: number;
  materialId: string;
  qty: string;
}

interface Props {
  materials: MaterialOption[];
  departments: { id: number; name: string }[];
  formAction: (formData: FormData) => void;
  pending: boolean;
}

export default function RecipeForm({
  materials,
  departments,
  formAction,
  pending,
}: Props) {
  const [sellingPrice, setSellingPrice] = useState("0");
  const [yieldPortions, setYieldPortions] = useState("1");
  const [overhead, setOverhead] = useState("0");
  const [rows, setRows] = useState<Row[]>([{ key: 0, materialId: "", qty: "" }]);
  const nextKey = useRef(1);

  const materialById = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );

  // Live line costs + totals.
  const lines = rows.map((row) => {
    const m = row.materialId ? materialById.get(row.materialId) : undefined;
    const qty = Number(row.qty) || 0;
    const rate = m?.weighted_avg_cost ?? 0;
    return { ...row, rate, lineCost: qty * rate, unit: m?.stock_unit ?? "" };
  });

  const sell = Number(sellingPrice) || 0;
  const yieldN = Math.max(1, Math.floor(Number(yieldPortions) || 1));
  const { batchCost, plateCost, margin, foodCostPct } = computeCosting({
    ingredients: lines.map((l) => ({ quantity: Number(l.qty) || 0, rate: l.rate })),
    yieldPortions: yieldN,
    sellingPrice: sell,
  });

  const foodTone =
    sell <= 0
      ? "text-neutral-700"
      : foodCostPct <= 35
        ? "text-emerald-600"
        : foodCostPct <= 45
          ? "text-amber-700"
          : "text-red-600";

  return (
    <form
      action={formAction}
      className="space-y-5 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">Add recipe</h3>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Recipe name">
          <input name="name" required placeholder="Chicken Pulav" className={inputCls} />
        </Field>
        <Field label="Category / cuisine" hint="Maps to a sheet tab">
          <input
            name="category"
            list="cuisine-options"
            placeholder="South Indian"
            className={inputCls}
          />
          <datalist id="cuisine-options">
            {CUISINES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Department" hint="Station that serves it">
          <select name="department_id" defaultValue="" className={inputCls}>
            <option value="">Unassigned</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Selling price" hint="₹ (retail)">
          <input
            name="selling_price"
            type="number"
            step="any"
            min="0"
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Yield portions" hint="Plates per batch">
          <input
            name="yield_portions"
            type="number"
            step="1"
            min="1"
            value={yieldPortions}
            onChange={(e) => setYieldPortions(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Overhead %" hint="Operational markup">
          <input
            name="overhead_percentage"
            type="number"
            step="any"
            min="0"
            value={overhead}
            onChange={(e) => setOverhead(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      {materials.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Add raw materials first — recipes need ingredients.
        </p>
      ) : (
        <div className="space-y-3">
          <span className={labelCls}>Ingredients</span>
          {rows.map((row, i) => {
            const line = lines[i];
            return (
              <div key={row.key} className="flex flex-wrap items-center gap-2">
                <select
                  name="ingredient_material"
                  value={row.materialId}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r) =>
                        r.key === row.key
                          ? { ...r, materialId: e.target.value }
                          : r,
                      ),
                    )
                  }
                  className={`${inputCls} min-w-[12rem] flex-1`}
                >
                  <option value="">Select material…</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.stock_unit})
                    </option>
                  ))}
                </select>
                <input
                  name="ingredient_qty"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Qty"
                  value={row.qty}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r) =>
                        r.key === row.key ? { ...r, qty: e.target.value } : r,
                      ),
                    )
                  }
                  className={`${inputCls} w-24`}
                />
                <span className="w-36 text-right text-xs tabular-nums text-neutral-500">
                  @ {inr(line.rate)} ={" "}
                  <span className="text-neutral-700">{inr(line.lineCost)}</span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setRows((rs) =>
                      rs.length > 1 ? rs.filter((r) => r.key !== row.key) : rs,
                    )
                  }
                  className="shrink-0 rounded-lg border border-[#e6e0d3] px-3 py-2 text-sm text-neutral-500 transition hover:border-red-500/30 hover:text-red-600"
                  aria-label="Remove ingredient"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                { key: nextKey.current++, materialId: "", qty: "" },
              ])
            }
            className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-[#efe9dd] hover:text-neutral-900"
          >
            + Add ingredient
          </button>
        </div>
      )}

      {/* Live costing calculator */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-4 sm:grid-cols-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
            Batch cost
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-neutral-900">
            {inr(batchCost)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
            Plate cost
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-neutral-900">
            {inr(plateCost)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
            Margin
          </p>
          <p
            className={`mt-1 text-lg font-semibold tabular-nums ${
              margin < 0 ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {inr(margin)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
            Food cost %
          </p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${foodTone}`}>
            {sell > 0 ? `${foodCostPct.toFixed(1)}%` : "—"}
          </p>
        </div>
      </div>

      <div className="sm:max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create recipe
        </SubmitButton>
      </div>
    </form>
  );
}
