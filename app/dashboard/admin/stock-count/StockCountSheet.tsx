"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../_components/forms";
import type { LiveStockRow } from "../../store/types";

interface MaterialRow {
  id: string;
  name: string;
  stock_unit: string;
  category: string | null;
}

interface DepartmentRow {
  id: number;
  name: string;
}

interface Props {
  materials: MaterialRow[];
  departments: DepartmentRow[];
  initialStock: LiveStockRow[];
}

export default function StockCountSheet({
  materials,
  departments,
  initialStock,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [stock, setStock] = useState<LiveStockRow[]>(initialStock);
  const [deptId, setDeptId] = useState<number>(
    departments.find((d) => d.name.toLowerCase() === "kitchen")?.id ??
      departments[0]?.id ??
      0,
  );
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Current system stock for a material at the selected department.
  const systemStock = useCallback(
    (materialId: string) => {
      const row = stock.find(
        (s) => s.raw_material_id === materialId && s.department_id === deptId,
      );
      return row ? Number(row.current_stock) : 0;
    },
    [stock, deptId],
  );

  const refreshStock = useCallback(async () => {
    const { data } = await supabase
      .from("live_stock")
      .select("*")
      .order("raw_material_name");
    if (data) setStock(data as LiveStockRow[]);
  }, [supabase]);

  // Switch department and clear any in-progress counts.
  function handleDeptChange(id: number) {
    setDeptId(id);
    setCounts({});
    setFeedback(null);
  }

  const visibleMaterials = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? materials.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            (m.category ?? "").toLowerCase().includes(q),
        )
      : materials;
  }, [materials, query]);

  // Rows with an entered count that differs from the system figure.
  const pendingVariances = useMemo(() => {
    return materials.flatMap((m) => {
      const raw = counts[m.id];
      if (raw === undefined || raw.trim() === "") return [];
      const counted = Number(raw);
      if (!Number.isFinite(counted)) return [];
      const current = systemStock(m.id);
      const delta = counted - current;
      if (delta === 0) return [];
      return [{ material: m, counted, current, delta }];
    });
  }, [materials, counts, systemStock]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (pendingVariances.length === 0) {
      setFeedback({
        type: "error",
        message: "No variances to post — enter counts that differ from system stock.",
      });
      return;
    }

    // Build VARIANCE_RECONCILIATION rows. A positive delta (counted more than
    // system) credits the department (to_department); a negative delta debits it
    // (from_department). Quantity is always the positive magnitude.
    const rows = pendingVariances.map(({ material, delta }) =>
      delta > 0
        ? {
            raw_material_id: material.id,
            from_department_id: null,
            to_department_id: deptId,
            type: "VARIANCE_RECONCILIATION",
            quantity: delta,
          }
        : {
            raw_material_id: material.id,
            from_department_id: deptId,
            to_department_id: null,
            type: "VARIANCE_RECONCILIATION",
            quantity: -delta,
          },
    );

    setPending(true);
    const { error } = await supabase.from("inventory_ledger").insert(rows);
    setPending(false);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      return;
    }
    setFeedback({
      type: "success",
      message: `Posted ${rows.length} variance adjustment${rows.length === 1 ? "" : "s"}. Stock now matches the physical count.`,
    });
    setCounts({});
    await refreshStock();
  }

  const deptName = departments.find((d) => d.id === deptId)?.name ?? "";

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-neutral-600">
            Department
          </span>
          <select
            value={deptId}
            onChange={(e) => handleDeptChange(Number(e.target.value))}
            className={`${inputCls} w-56`}
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search material…"
          className="w-64 max-w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-5 py-3 font-medium">Material</th>
              <th className="px-5 py-3 text-right font-medium">System</th>
              <th className="px-5 py-3 text-right font-medium">
                Physical count
              </th>
              <th className="px-5 py-3 text-right font-medium">Variance</th>
            </tr>
          </thead>
          <tbody>
            {visibleMaterials.map((m) => {
              const current = systemStock(m.id);
              const raw = counts[m.id];
              const counted =
                raw !== undefined && raw.trim() !== "" ? Number(raw) : null;
              const delta =
                counted !== null && Number.isFinite(counted)
                  ? counted - current
                  : null;
              return (
                <tr
                  key={m.id}
                  className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                >
                  <td className="px-5 py-3">
                    <div className="font-medium text-neutral-900">{m.name}</div>
                    {m.category && (
                      <div className="text-[11px] text-neutral-500">
                        {m.category}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-neutral-600">
                    {current} {m.stock_unit}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      inputMode="decimal"
                      value={raw ?? ""}
                      onChange={(e) =>
                        setCounts((c) => ({ ...c, [m.id]: e.target.value }))
                      }
                      placeholder={String(current)}
                      className="w-28 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-1.5 text-right text-sm tabular-nums text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 [color-scheme:light]"
                    />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {delta === null || delta === 0 ? (
                      <span className="text-neutral-500">—</span>
                    ) : (
                      <span
                        className={
                          delta > 0 ? "text-emerald-600" : "text-red-600"
                        }
                      >
                        {delta > 0 ? "+" : ""}
                        {delta} {m.stock_unit}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-neutral-600">
          {pendingVariances.length === 0 ? (
            <>No changes for {deptName}.</>
          ) : (
            <>
              <span className="font-semibold text-neutral-900">
                {pendingVariances.length}
              </span>{" "}
              adjustment{pendingVariances.length === 1 ? "" : "s"} ready for{" "}
              {deptName}.
            </>
          )}
        </p>
        <div className="w-full sm:w-64">
          <SubmitButton pending={pending} pendingLabel="Posting…">
            Post variance &amp; reconcile
          </SubmitButton>
        </div>
      </div>

      <div className="mt-4">
        <FormFeedback feedback={feedback} />
      </div>
    </form>
  );
}
