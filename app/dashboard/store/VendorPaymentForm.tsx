"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inr } from "@/lib/format";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "./ui";
import type { VendorOption } from "./types";

const PAYMENT_MODES = ["UPI", "Bank Transfer", "Cash", "Cheque", "Card"];

interface Props {
  supabase: SupabaseClient;
  vendors: VendorOption[];
}

export default function VendorPaymentForm({ supabase, vendors }: Props) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [vendorId, setVendorId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(PAYMENT_MODES[0]);
  const [utr, setUtr] = useState("");
  const [date, setDate] = useState(today);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const amountNum = Number(amount) || 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (!vendorId) return setFeedback({ type: "error", message: "Select a vendor." });
    if (amountNum <= 0) return setFeedback({ type: "error", message: "Amount must be greater than zero." });
    if (!date) return setFeedback({ type: "error", message: "Select a payment date." });

    setPending(true);
    const { error } = await supabase.from("vendor_payments").insert({
      vendor_id: vendorId,
      amount_paid: amountNum,
      payment_mode: mode,
      reference_utr: utr.trim() || null,
      payment_date: date,
    });
    setPending(false);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      return;
    }
    void triggerSheetSync(); // best-effort mirror to the location's sheet
    const vendor = vendors.find((v) => v.id === vendorId);
    setFeedback({
      type: "success",
      message: `Logged ${inr(amountNum)} payment to ${vendor?.name ?? "vendor"}.`,
    });
    setAmount("");
    setUtr("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Vendor">
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className={inputCls}
        >
          <option value="">Select vendor…</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.vendor_code})
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount paid">
          <input
            type="number"
            step="any"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={inputCls}
          />
        </Field>
        <Field label="Payment mode">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className={inputCls}
          >
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reference / UTR" hint="Optional">
          <input
            type="text"
            value={utr}
            onChange={(e) => setUtr(e.target.value)}
            placeholder="e.g. UTR / cheque no."
            className={inputCls}
          />
        </Field>
        <Field label="Payment date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <FormFeedback feedback={feedback} />
      <SubmitButton pending={pending} pendingLabel="Logging…">
        Log payment
      </SubmitButton>
    </form>
  );
}
