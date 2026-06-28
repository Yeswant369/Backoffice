"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { settleDue } from "./actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

const MODES = ["CASH", "UPI", "CARD", "BANK", "ADJUST"];

export default function SettleControl({
  id,
  outstanding,
}: {
  id: string;
  outstanding: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(outstanding));
  const [mode, setMode] = useState("CASH");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setAmount(String(outstanding));
          setErr(null);
          setOpen(true);
        }}
        className="rounded-md border border-[#d9d1c1] bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-[#f3eee3]"
      >
        Settle
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <input
        type="number"
        step="any"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-24 rounded-md border border-[#d9d1c1] bg-white px-2 py-1 text-xs tabular-nums"
      />
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        className="rounded-md border border-[#d9d1c1] bg-white px-2 py-1 text-xs"
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const res = await settleDue(id, Number(amount), mode);
            if (res.error) {
              setErr(res.error);
              return;
            }
            await triggerSheetSync();
            setOpen(false);
            router.refresh();
          })
        }
        className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-md px-1.5 py-1 text-xs text-neutral-500 hover:text-neutral-900"
      >
        ✕
      </button>
      {err && <span className="w-full text-right text-xs text-red-600">{err}</span>}
    </div>
  );
}
