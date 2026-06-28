"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../_components/forms";
import { recordPettyCash, type PettyState } from "./actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

const CATEGORIES = [
  "Groceries",
  "Maintenance",
  "Transport",
  "Utilities",
  "Supplies",
  "Staff Welfare",
  "Miscellaneous",
];

export default function PettyCashForm() {
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      ),
    [],
  );
  const [state, formAction, pending] = useActionState<
    PettyState | undefined,
    FormData
  >(recordPettyCash, undefined);
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

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">Log an expense</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Amount (₹)">
          <input
            name="amount"
            type="number"
            step="any"
            min="0"
            required
            className={inputCls}
          />
        </Field>
        <Field label="Category">
          <select name="category" defaultValue="Transport" className={inputCls}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input
            name="date"
            type="date"
            defaultValue={today}
            max={today}
            required
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="Description" hint="Optional">
        <input name="description" className={inputCls} />
      </Field>
      <FormFeedback feedback={feedback} />
      <div className="sm:max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Logging…">
          Log expense
        </SubmitButton>
      </div>
    </form>
  );
}
