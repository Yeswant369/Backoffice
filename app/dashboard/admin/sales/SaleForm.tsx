"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../_components/forms";
import Combobox from "../../_components/Combobox";
import { recordManualSale, type SaleState } from "./actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

export interface RecipeLite {
  id: string;
  name: string;
  selling_price: number;
}

export default function SaleForm({ recipes }: { recipes: RecipeLite[] }) {
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      ),
    [],
  );
  const [state, formAction, pending] = useActionState<
    SaleState | undefined,
    FormData
  >(recordManualSale, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.token) void triggerSheetSync();
  }, [state?.token]);

  const feedback: Feedback | null = state?.error
    ? { type: "error", message: state.error }
    : state?.success
      ? { type: "success", message: state.success }
      : null;

  return (
    // key remount per success — form.reset() can't clear Combobox state, and a
    // lingering dish must never be silently inherited by the next entry.
    <form
      key={state?.token ?? "init"}
      ref={formRef}
      action={formAction}
      className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">Record a sale</h3>
      {recipes.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No recipes yet — add one in Recipe Builder first.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Dish">
              <Combobox
                name="recipe_id"
                required
                placeholder="Type to search…"
                options={recipes.map((r) => ({
                  id: r.id,
                  label: r.name,
                  hint: `₹${r.selling_price}`,
                }))}
              />
            </Field>
            <Field label="Quantity sold">
              <input
                name="quantity_sold"
                type="number"
                step="1"
                min="1"
                required
                className={inputCls}
              />
            </Field>
            <Field label="Sale date">
              <input
                name="sale_date"
                type="date"
                defaultValue={today}
                max={today}
                required
                className={inputCls}
              />
            </Field>
          </div>
          <FormFeedback feedback={feedback} />
          <div className="sm:max-w-xs">
            <SubmitButton pending={pending} pendingLabel="Recording…">
              Record sale
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
