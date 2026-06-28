"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../../../_components/forms";
import { recordVendorPayment, type ActionState } from "../../actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

const MODES = ["CASH", "UPI", "CARD", "BANK", "CHEQUE"];

export default function VendorPaymentForm({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      ),
    [],
  );
  const [state, formAction, pending] = useActionState<
    ActionState | undefined,
    FormData
  >(recordVendorPayment, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      void triggerSheetSync();
      router.refresh();
    }
  }, [state?.success, state?.token, router]);

  const feedback: Feedback | null = state?.error
    ? { type: "error", message: state.error }
    : state?.success
      ? { type: "success", message: state.success }
      : null;

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mb-8 space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <input type="hidden" name="vendor_id" value={vendorId} />
      <h3 className="text-sm font-semibold text-neutral-900">Record a payment</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Amount (₹)">
          <input
            name="amount_paid"
            type="number"
            step="any"
            min="0"
            required
            className={inputCls}
          />
        </Field>
        <Field label="Mode">
          <select name="payment_mode" defaultValue="CASH" className={inputCls}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference / UTR" hint="Optional">
          <input name="reference_utr" className={inputCls} />
        </Field>
        <Field label="Date">
          <input
            name="payment_date"
            type="date"
            defaultValue={today}
            max={today}
            className={inputCls}
          />
        </Field>
      </div>
      <FormFeedback feedback={feedback} />
      <div className="sm:max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Recording…">
          Record payment
        </SubmitButton>
      </div>
    </form>
  );
}
