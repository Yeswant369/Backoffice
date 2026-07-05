"use client";

import { useMemo, useRef, useState } from "react";
import { inr } from "@/lib/format";
import { computeCosting } from "@/lib/google/recipe-matrix";
import Combobox from "../../_components/Combobox";
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

const COURSES = ["Starter", "Main", "Dessert", "Beverage", "Side", "Snack"];

/** A sub-recipe offered as an ingredient (cost = per portion of the sub). */
export interface SubRecipeOption {
  id: string;
  name: string;
  unit_cost: number;
}

export interface RecipeFormRow {
  materialId: string | null;
  subRecipeId: string | null;
  qty: string;
  notes: string;
}

export interface RecipeFormInitial {
  recipeId: string;
  name: string;
  category: string;
  course: string;
  departmentId: string;
  sellingPrice: string;
  yieldPortions: string;
  overhead: string;
  posItemCode: string;
  videoUrl: string;
  rows: RecipeFormRow[];
}

interface Row {
  key: number;
  refId: string; // material OR sub-recipe id (uuids never collide)
  qty: string;
  notes: string;
}

interface Props {
  materials: MaterialOption[];
  /** Recipes usable as sub-recipe lines (parent must exclude the edited one). */
  subRecipes: SubRecipeOption[];
  departments: { id: number; name: string }[];
  formAction: (formData: FormData) => void;
  pending: boolean;
  /** Present = edit mode (submits recipe_id for updateRecipe). */
  initial?: RecipeFormInitial;
}

export default function RecipeForm({
  materials,
  subRecipes,
  departments,
  formAction,
  pending,
  initial,
}: Props) {
  // Seed rows use indices 0..n-1; the ref hands out keys AFTER that range and
  // is only touched in event handlers (never during render — lint rule).
  const nextKey = useRef((initial?.rows.length || 1) + 1);

  const [sellingPrice, setSellingPrice] = useState(initial?.sellingPrice ?? "0");
  const [yieldPortions, setYieldPortions] = useState(initial?.yieldPortions ?? "1");
  const [overhead, setOverhead] = useState(initial?.overhead ?? "0");
  const [rows, setRows] = useState<Row[]>(() =>
    !initial || initial.rows.length === 0
      ? [{ key: 0, refId: "", qty: "", notes: "" }]
      : initial.rows.map((r, i) => ({
          key: i,
          refId: r.subRecipeId ?? r.materialId ?? "",
          qty: r.qty,
          notes: r.notes,
        })),
  );

  const materialById = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );
  const subById = useMemo(
    () => new Map(subRecipes.map((s) => [s.id, s])),
    [subRecipes],
  );

  // One picker for both: materials (code hint) + sub-recipes ("SUB · plate cost").
  const pickerOptions = useMemo(
    () => [
      ...materials.map((m) => ({
        id: m.id,
        label: m.name,
        hint: m.code ?? m.stock_unit,
      })),
      ...subRecipes.map((s) => ({
        id: s.id,
        label: s.name,
        hint: `SUB · ${inr(s.unit_cost)}`,
      })),
    ],
    [materials, subRecipes],
  );

  // Live line costs + totals (sub lines cost per portion of the sub-recipe).
  const lines = rows.map((row) => {
    const mat = row.refId ? materialById.get(row.refId) : undefined;
    const sub = !mat && row.refId ? subById.get(row.refId) : undefined;
    const qty = Number(row.qty) || 0;
    const rate = mat ? (mat.weighted_avg_cost ?? 0) : (sub?.unit_cost ?? 0);
    return {
      ...row,
      rate,
      lineCost: qty * rate,
      unit: mat ? mat.stock_unit : sub ? "portion" : "",
      brand: mat?.brand ?? null,
      isSub: Boolean(sub),
    };
  });

  const sell = Number(sellingPrice) || 0;
  const yieldN = Math.max(1, Math.floor(Number(yieldPortions) || 1));
  const { batchCost, plateCost: basePlateCost } = computeCosting({
    ingredients: lines.map((l) => ({ quantity: Number(l.qty) || 0, rate: l.rate })),
    yieldPortions: yieldN,
    sellingPrice: sell,
  });
  // Match the DB's recipe_cogs: overhead multiplies the per-plate cost.
  const oh = Math.max(0, Number(overhead) || 0);
  const plateCost = basePlateCost * (1 + oh / 100);
  const margin = sell - plateCost;
  const foodCostPct = sell > 0 ? (plateCost / sell) * 100 : 0;

  // What the server actually receives — kind resolved by which map owns the id.
  // Only rows that are COMPLETELY empty are skipped; a half-filled row (item
  // without qty, qty without item) is sent as-is so the server rejects LOUDLY —
  // silently dropping it here would delete the ingredient on edit-save.
  const ingredientsJson = useMemo(
    () =>
      JSON.stringify(
        rows
          .filter((r) => r.refId || r.qty.trim() || r.notes.trim())
          .map((r) => ({
            raw_material_id: materialById.has(r.refId) ? r.refId : null,
            sub_recipe_id: subById.has(r.refId) ? r.refId : null,
            quantity_needed: Number(r.qty),
            notes: r.notes.trim() || null,
          })),
      ),
    [rows, materialById, subById],
  );

  const foodTone =
    sell <= 0
      ? "text-neutral-700"
      : foodCostPct <= 35
        ? "text-emerald-600"
        : foodCostPct <= 45
          ? "text-amber-700"
          : "text-red-600";

  const patchRow = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form
      action={formAction}
      className="space-y-5 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">
        {initial ? "Edit recipe" : "Add recipe"}
      </h3>
      {initial && <input type="hidden" name="recipe_id" value={initial.recipeId} />}
      <input type="hidden" name="ingredients_json" value={ingredientsJson} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Recipe name">
          <input
            name="name"
            required
            defaultValue={initial?.name ?? ""}
            placeholder="Chicken Pulav"
            className={inputCls}
          />
        </Field>
        <Field label="Cuisine" hint="Groups the recipe list & sheet tabs">
          <input
            name="category"
            list="cuisine-options"
            defaultValue={initial?.category ?? ""}
            placeholder="South Indian"
            className={inputCls}
          />
          <datalist id="cuisine-options">
            {CUISINES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Course" hint="Starter / Main / Dessert…">
          <input
            name="course"
            list="course-options"
            defaultValue={initial?.course ?? ""}
            placeholder="Main"
            className={inputCls}
          />
          <datalist id="course-options">
            {COURSES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Department" hint="Station that serves it">
          <select
            name="department_id"
            defaultValue={initial?.departmentId ?? ""}
            className={inputCls}
          >
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
        <Field label="POS code" hint="Petpooja item id — auto-matches sales">
          <input
            name="pos_item_code"
            defaultValue={initial?.posItemCode ?? ""}
            placeholder="164516499"
            className={inputCls}
          />
        </Field>
        <Field label="Video link" hint="Technique video / attachment URL">
          <input
            name="video_url"
            type="url"
            defaultValue={initial?.videoUrl ?? ""}
            placeholder="https://…"
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
          <span className={labelCls}>
            Ingredients{" "}
            <span className="normal-case text-neutral-500">
              (materials or sub-recipes — sub-recipe costs roll up automatically)
            </span>
          </span>
          {rows.map((row, i) => {
            const line = lines[i];
            return (
              <div
                key={row.key}
                className="rounded-lg border border-[#e6e0d3] bg-white p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <Combobox
                      name={`ingredient_${row.key}`}
                      placeholder="Material or sub-recipe…"
                      options={pickerOptions}
                      value={row.refId}
                      onChange={(id) => patchRow(row.key, { refId: id })}
                    />
                  </div>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Qty"
                    value={row.qty}
                    onChange={(e) => patchRow(row.key, { qty: e.target.value })}
                    className={`${inputCls} w-24`}
                  />
                  <span className="w-40 text-right text-xs tabular-nums text-neutral-500">
                    @ {inr(line.rate)}
                    {line.unit ? `/${line.unit}` : ""} ={" "}
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
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {line.isSub && (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
                      Sub-recipe
                    </span>
                  )}
                  {line.brand && (
                    <span className="text-[11px] text-neutral-500">
                      Brand: {line.brand}
                    </span>
                  )}
                  <input
                    placeholder="Technique note — e.g. blanch first, room temp…"
                    value={row.notes}
                    maxLength={500}
                    onChange={(e) => patchRow(row.key, { notes: e.target.value })}
                    className="min-w-[14rem] flex-1 rounded-lg border border-transparent bg-[#faf7f1] px-2.5 py-1.5 text-xs text-neutral-700 outline-none transition placeholder:text-neutral-400 focus:border-[#e6e0d3]"
                  />
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                { key: nextKey.current++, refId: "", qty: "", notes: "" },
              ])
            }
            className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-[#efe9dd] hover:text-neutral-900"
          >
            + Add ingredient
          </button>
        </div>
      )}

      {/* Live costing chain: line costs → batch → plate → margin → food % */}
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
        <SubmitButton
          pending={pending}
          pendingLabel={initial ? "Saving…" : "Creating…"}
        >
          {initial ? "Save changes" : "Create recipe"}
        </SubmitButton>
      </div>
    </form>
  );
}
