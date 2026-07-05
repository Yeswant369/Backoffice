"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../_components/forms";
import Combobox from "../_components/Combobox";
import type { RecipeOption } from "./types";

interface Props {
  supabase: SupabaseClient;
  recipes: RecipeOption[];
}

export default function SimulateSaleForm({ supabase, recipes }: Props) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [recipeId, setRecipeId] = useState("");
  const [qty, setQty] = useState("1");
  const [saleDate, setSaleDate] = useState(today);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const recipe = useMemo(
    () => recipes.find((r) => r.id === recipeId) ?? null,
    [recipes, recipeId],
  );
  const qtyNum = Math.floor(Number(qty)) || 0;

  // Preview of what the database trigger will deduct from the Kitchen.
  const deductions = useMemo(() => {
    if (!recipe || qtyNum <= 0) return [];
    return recipe.recipe_ingredients
      .filter((ri) => ri.raw_materials)
      .map((ri) => ({
        name: ri.raw_materials!.name,
        unit: ri.raw_materials!.stock_unit,
        amount: ri.quantity_needed * qtyNum,
      }));
  }, [recipe, qtyNum]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (!recipeId) return setFeedback({ type: "error", message: "Select a dish." });
    if (qtyNum <= 0) return setFeedback({ type: "error", message: "Quantity sold must be at least 1." });

    setPending(true);
    // Insert the sale; the on_manual_sale trigger explodes the recipe and posts
    // MANUAL_SALE deductions into the ledger automatically.
    const { error } = await supabase.from("manual_sales_log").insert({
      recipe_id: recipeId,
      quantity_sold: qtyNum,
      sale_date: saleDate,
    });
    setPending(false);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      return;
    }
    void triggerSheetSync(); // best-effort mirror to the location's sheet
    setFeedback({
      type: "success",
      message: `Logged ${qtyNum} × ${recipe?.name}. Ingredients deducted from Kitchen.`,
    });
    // Clear the dish so a second blind click can never double-deduct stock.
    setRecipeId("");
    setQty("1");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Dish">
        <Combobox
          name="recipe_id"
          value={recipeId}
          onChange={setRecipeId}
          placeholder="Type to search…"
          options={recipes.map((r) => ({
            id: r.id,
            label: r.name,
            hint: r.selling_price != null ? `₹${r.selling_price}` : undefined,
          }))}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantity sold">
          <input
            type="number"
            step="1"
            min="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Sale date">
          <input
            type="date"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      {deductions.length > 0 && (
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Will deduct from Kitchen
          </p>
          <ul className="space-y-1.5">
            {deductions.map((d) => (
              <li
                key={d.name}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-neutral-700">{d.name}</span>
                <span className="font-semibold tabular-nums text-neutral-900">
                  −{d.amount} {d.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recipe && deductions.length === 0 && qtyNum > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          This dish has no recipe ingredients defined — nothing will be deducted.
        </p>
      )}

      <FormFeedback feedback={feedback} />
      <SubmitButton pending={pending} pendingLabel="Logging sale…">
        Simulate sale
      </SubmitButton>
    </form>
  );
}
