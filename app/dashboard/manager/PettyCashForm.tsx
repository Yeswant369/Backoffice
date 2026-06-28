"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../_components/forms";
import { logPettyCash, type ActionState } from "./actions";
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
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [state, formAction, pending] = useActionState<
    ActionState | undefined,
    FormData
  >(logPettyCash, undefined);
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount">
          <input
            name="amount"
            type="number"
            step="any"
            min="0"
            required
            placeholder="0.00"
            className={inputCls}
          />
        </Field>
        <Field label="Category">
          <select name="category" defaultValue={CATEGORIES[0]} className={inputCls}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description" hint="Optional">
        <input
          name="description"
          type="text"
          placeholder="What was this for?"
          className={inputCls}
        />
      </Field>

      <Field label="Date">
        <input
          name="date"
          type="date"
          required
          defaultValue={today}
          className={`${inputCls} max-w-xs`}
        />
      </Field>

      <FormFeedback feedback={feedback} />
      <SubmitButton pending={pending} pendingLabel="Logging…">
        Log expense
      </SubmitButton>
    </form>
  );
}
