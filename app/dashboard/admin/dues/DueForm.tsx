"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../_components/forms";
import { recordDue, type DueState } from "./actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

export default function DueForm() {
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      ),
    [],
  );
  const [state, formAction, pending] = useActionState<
    DueState | undefined,
    FormData
  >(recordDue, undefined);
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
      <h3 className="text-sm font-semibold text-neutral-900">Record a due</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Person name">
          <input name="person_name" required className={inputCls} />
        </Field>
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
        <Field label="Reason" hint="Optional">
          <input name="reason" className={inputCls} />
        </Field>
        <Field label="Linked date" hint="Optional">
          <input name="linked_date" type="date" max={today} className={inputCls} />
        </Field>
      </div>
      <Field label="Notes" hint="Optional">
        <textarea name="notes" rows={2} className={inputCls} />
      </Field>
      <FormFeedback feedback={feedback} />
      <div className="sm:max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Recording…">
          Record due
        </SubmitButton>
      </div>
    </form>
  );
}
