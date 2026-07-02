"use client";

import { useMemo, useState } from "react";
import DateRangePresets from "../../_components/DateRangePresets";

export default function AccountingExport() {
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      ),
    [],
  );
  const ninety = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  }, []);
  const [from, setFrom] = useState(ninety);
  const [to, setTo] = useState(today);

  const href = (type: "purchases" | "payments") =>
    `/api/accounting/export?type=${type}&from=${from}&to=${to}`;

  return (
    <div className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5">
      <h3 className="text-sm font-semibold text-neutral-900">Export for accounting</h3>
      <DateRangePresets
        value={{ from, to }}
        onChange={(r) => {
          setFrom(r.from);
          setTo(r.to);
        }}
      />
      <div className="flex flex-wrap gap-3 pt-1">
        <a
          href={href("purchases")}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          Export Purchases (CSV)
        </a>
        <a
          href={href("payments")}
          className="rounded-lg border border-[#d9d1c1] bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 transition hover:bg-[#f3eee3]"
        >
          Export Payments (CSV)
        </a>
      </div>
      <p className="text-xs text-neutral-500">
        Standard CSV — import into Tally or Zoho Books as bills (purchases) and
        payments. Scoped to your outlet.
      </p>
    </div>
  );
}
