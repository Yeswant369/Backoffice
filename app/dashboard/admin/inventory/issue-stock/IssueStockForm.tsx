"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import {
  Field,
  FormFeedback,
  inputCls,
  type Feedback,
} from "@/app/dashboard/_components/forms";
import Combobox from "@/app/dashboard/_components/Combobox";
import { issueStockBatch } from "../actions";

interface Material {
  id: string;
  name: string;
  code: string | null;
  stock_unit: string;
}
interface Dept {
  id: number;
  name: string;
}
interface StockRow {
  raw_material_id: string;
  department_id: number;
  current_stock: number;
}

interface Props {
  materials: Material[];
  departments: Dept[];
  storeDeptId: number;
  stock: StockRow[];
}

interface Line {
  key: number;
  materialId: string;
  qty: string;
}

/** Today's date in the location's timezone (IST), as a YYYY-MM-DD input value. */
const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );

/**
 * Cart-style issue entry: pick the source + destination departments and the
 * issue date ONCE, add every material moving in that run, submit once. Each
 * line becomes one dated INTER_DEPARTMENT_TRANSFER ledger row. Each material
 * shows its current stock in the source department as you pick it.
 */
export default function IssueStockForm({
  materials,
  departments,
  storeDeptId,
  stock,
}: Props) {
  const router = useRouter();
  const nextKey = useRef(1);
  const today = useMemo(() => todayIST(), []);

  const [fromId, setFromId] = useState(String(storeDeptId));
  const [toId, setToId] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [lines, setLines] = useState<Line[]>([{ key: 0, materialId: "", qty: "" }]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const materialById = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );
  const materialOptions = useMemo(
    () =>
      materials.map((m) => ({
        id: m.id,
        label: m.name,
        hint: m.code ?? m.stock_unit,
      })),
    [materials],
  );

  // Current stock per material in the SOURCE department (client-side hint;
  // the server action re-validates against live_stock on submit).
  const availByMaterial = useMemo(() => {
    const dept = Number(fromId);
    const map = new Map<string, number>();
    for (const s of stock) {
      if (s.department_id === dept) map.set(s.raw_material_id, Number(s.current_stock));
    }
    return map;
  }, [stock, fromId]);

  function patchLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((ls) => [...ls, { key: nextKey.current++, materialId: "", qty: "" }]);
  }

  function removeLine(key: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);

    if (!toId)
      return setFeedback({ type: "error", message: "Select a destination department." });
    // Drop ONLY completely-empty rows — a half-filled row is a mistake to flag.
    const filled = lines.filter((l) => l.materialId || l.qty);
    if (filled.length === 0)
      return setFeedback({ type: "error", message: "Add at least one line item." });
    for (const [i, l] of filled.entries()) {
      if (!l.materialId)
        return setFeedback({
          type: "error",
          message: `Line ${i + 1}: pick a material (or clear the row).`,
        });
      if (!(Number(l.qty) > 0))
        return setFeedback({
          type: "error",
          message: `Line ${i + 1} (${materialById.get(l.materialId)?.name ?? "material"}): quantity must be greater than zero.`,
        });
    }

    setPending(true);
    try {
      const fd = new FormData();
      fd.set("from_department_id", fromId);
      fd.set("to_department_id", toId);
      fd.set("issue_date", issueDate);
      fd.set(
        "lines",
        JSON.stringify(
          filled.map((l) => ({
            raw_material_id: l.materialId,
            quantity: Number(l.qty),
          })),
        ),
      );
      const result = await issueStockBatch(undefined, fd);
      if (result?.error) {
        setFeedback({ type: "error", message: result.error });
        return;
      }

      const sync = await triggerSheetSync();
      setFeedback({
        type: "success",
        message: sync.ok
          ? `${result?.success ?? "Stock issued."} Synced to the Issues tab.`
          : `${result?.success ?? "Stock issued."} (Sheet sync: ${sync.error})`,
      });
      // Reset for the next run — keep from/to (issues go out in batches to the
      // same department), but snap the date back to today so a backdate never
      // leaks forward.
      setLines([{ key: nextKey.current++, materialId: "", qty: "" }]);
      setIssueDate(todayIST());
      router.refresh();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setPending(false);
    }
  }

  const targets = departments.filter((d) => d.id !== Number(fromId));
  const lineCount = lines.filter((l) => l.materialId || l.qty).length;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">Issue stock</h3>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="From department">
          <select
            name="from_department_id"
            value={fromId}
            onChange={(e) => {
              setFromId(e.target.value);
              if (e.target.value === toId) setToId("");
            }}
            className={inputCls}
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To department">
          <select
            name="to_department_id"
            required
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className={inputCls}
          >
            <option value="" disabled>
              Select destination…
            </option>
            {targets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Issue date">
          <input
            name="issue_date"
            type="date"
            value={issueDate}
            max={today}
            onChange={(e) => setIssueDate(e.target.value)}
            required
            className={inputCls}
          />
        </Field>
      </div>

      <div className="space-y-3">
        {lines.map((l, i) => {
          const mat = materialById.get(l.materialId);
          const avail = l.materialId ? (availByMaterial.get(l.materialId) ?? 0) : null;
          const exceeds = avail !== null && (Number(l.qty) || 0) > avail;
          return (
            <div key={l.key} className="rounded-lg border border-[#e6e0d3] bg-white p-3">
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
                <Field label={i === 0 ? "Material" : ""}>
                  <Combobox
                    name={`material_${l.key}`}
                    value={l.materialId}
                    onChange={(id) => patchLine(l.key, { materialId: id })}
                    placeholder="Type to search materials…"
                    options={materialOptions}
                  />
                </Field>
                <Field label={i === 0 ? `Qty${mat?.stock_unit ? ` (${mat.stock_unit})` : ""}` : ""}>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={l.qty}
                    onChange={(e) => patchLine(l.key, { qty: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <div className="flex items-end pb-0.5">
                  <button
                    type="button"
                    aria-label="Remove line"
                    onClick={() => removeLine(l.key)}
                    disabled={lines.length === 1}
                    className="rounded-lg border border-[#e6e0d3] px-2.5 py-2 text-neutral-500 transition hover:text-red-600 disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {mat && avail !== null && (
                <p className={`mt-1.5 text-xs ${exceeds ? "text-red-600" : "text-neutral-500"}`}>
                  Available in source:{" "}
                  <span className="font-semibold tabular-nums">
                    {avail} {mat.stock_unit}
                  </span>
                  {exceeds && " — quantity exceeds available stock."}
                </p>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={addLine}
          className="rounded-lg border border-dashed border-[#cdc4b1] px-3 py-2 text-sm font-medium text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-900"
        >
          + Add line
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6e0d3] pt-4">
        <p className="text-sm text-neutral-600">
          Lines to issue{" "}
          <span className="text-base font-semibold tabular-nums text-neutral-900">
            {lineCount}
          </span>
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {pending ? "Issuing…" : "Issue stock"}
        </button>
      </div>
      <FormFeedback feedback={feedback} />
    </form>
  );
}
