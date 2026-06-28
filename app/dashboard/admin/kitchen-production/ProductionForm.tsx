"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../_components/forms";
import { recordProduction, type ProductionState } from "./actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

export interface RecipeLite {
  id: string;
  name: string;
  department_id: number | null;
}
export interface DeptLite {
  id: number;
  name: string;
}

export default function ProductionForm({
  recipes,
  departments,
}: {
  recipes: RecipeLite[];
  departments: DeptLite[];
}) {
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      ),
    [],
  );
  const [state, formAction, pending] = useActionState<
    ProductionState | undefined,
    FormData
  >(recordProduction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      void triggerSheetSync();
    }
  }, [state?.success, state?.token]);

  const feedback: Feedback | null = state?.error
    ? { type: "error", message: state.error }
    : state?.success
      ? { type: "success", message: state.success }
      : null;

  if (recipes.length === 0 || departments.length === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Add at least one recipe and one department first.
      </p>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">Record production</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <Field label="Department" hint="Defaults to the dish's department">
          <select name="department_id" defaultValue="" className={inputCls}>
            <option value="">Dish&apos;s department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input
            name="production_date"
            type="date"
            defaultValue={today}
            max={today}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Prepared qty">
          <input name="prepared_qty" type="number" step="any" min="0" required className={inputCls} />
        </Field>
        <Field label="Sold qty" hint="Auto-filled from sales; override if needed">
          <input name="sold_qty" type="number" step="any" min="0" defaultValue="0" className={inputCls} />
        </Field>
        <Field label="Wasted qty" hint="Prepared-item wastage">
          <input name="wastage_qty" type="number" step="any" min="0" defaultValue="0" className={inputCls} />
        </Field>
      </div>
      <FormFeedback feedback={feedback} />
      <div className="sm:max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Recording…">
          Record production
        </SubmitButton>
      </div>
    </form>
  );
}
