"use client";

import { useActionState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { logReconciliation, type ReconciliationState } from "./actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

const ease = [0.22, 1, 0.36, 1] as const;

interface Field {
  name: string;
  label: string;
}

const CHANNELS: Field[] = [
  { name: "dine_in_gross", label: "Dine-in gross" },
  { name: "zomato_gross", label: "Zomato gross" },
  { name: "swiggy_gross", label: "Swiggy gross" },
  { name: "aggregator_commissions", label: "Aggregator commissions" },
];

const COLLECTIONS: Field[] = [
  { name: "cash_collected", label: "Cash collected" },
  { name: "upi_collected", label: "UPI collected" },
  { name: "card_collected", label: "Card collected" },
  { name: "actual_bank_deposit", label: "Actual bank deposit" },
];

function MoneyInput({ name, label }: Field) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={name}
        className="block text-[11px] font-medium uppercase tracking-wider text-neutral-600"
      >
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">
          ₹
        </span>
        <input
          id={name}
          name={name}
          type="number"
          step="0.01"
          min="0"
          defaultValue="0"
          className="w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] py-2.5 pl-7 pr-3 text-sm tabular-nums text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
        />
      </div>
    </div>
  );
}

export default function ReconciliationForm() {
  const [state, formAction, pending] = useActionState<
    ReconciliationState | undefined,
    FormData
  >(logReconciliation, undefined);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (state?.success) void triggerSheetSync();
  }, [state?.success]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-6"
    >
      <h2 className="text-sm font-semibold text-neutral-900">
        Log daily reconciliation
      </h2>
      <p className="mt-1 text-xs text-neutral-500">
        Record the day&apos;s sales channels and collections to match the bank
        deposit. Saving an existing date updates it.
      </p>

      <form action={formAction} className="mt-5 space-y-5">
        <div className="max-w-xs space-y-1.5">
          <label
            htmlFor="date"
            className="block text-[11px] font-medium uppercase tracking-wider text-neutral-600"
          >
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={today}
            className="w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2.5 text-sm text-neutral-900 outline-none transition [color-scheme:light] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
          />
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Sales channels
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CHANNELS.map((f) => (
              <MoneyInput key={f.name} {...f} />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Collections & deposit
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {COLLECTIONS.map((f) => (
              <MoneyInput key={f.name} {...f} />
            ))}
          </div>
        </div>

        {state?.error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
          >
            {state.error}
          </p>
        )}
        {state?.success && (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-600"
          >
            {state.success}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Saving…
              </>
            ) : (
              "Save reconciliation"
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
