"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../_components/forms";
import { logSale, type ActionState } from "./actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

export interface RecipeLite {
  id: string;
  name: string;
  selling_price: number;
}

export default function SalesLogForm({ recipes }: { recipes: RecipeLite[] }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [state, formAction, pending] = useActionState<
    ActionState | undefined,
    FormData
  >(logSale, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      void triggerSheetSync();
    }
  }, [state?.success]);

  const feedback: Feedback | null = state?.error
    ? { type: "error", message: state.error }
    : state?.success
      ? { type: "success", message: state.success }
      : null;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <Field label="Dish">
        <select name="recipe_id" required defaultValue="" className={inputCls}>
          <option value="" disabled>
            Select dish…
          </option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantity sold">
          <input
            name="quantity_sold"
            type="number"
            step="1"
            min="1"
            required
            defaultValue="1"
            className={inputCls}
          />
        </Field>
        <Field label="Sale date">
          <input
            name="sale_date"
            type="date"
            required
            defaultValue={today}
            className={inputCls}
          />
        </Field>
      </div>

      <p className="text-[11px] text-neutral-500">
        Logging a sale deducts the dish&apos;s recipe ingredients from Kitchen
        stock automatically.
      </p>

      <FormFeedback feedback={feedback} />
      <SubmitButton pending={pending} pendingLabel="Logging…">
        Log sale
      </SubmitButton>
    </form>
  );
}
