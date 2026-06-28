"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { PRIMARY_BUTTON, GHOST_BUTTON } from "@/app/dashboard/_components/accents";
import {
  pullStockCount,
  pushStockTemplate,
  submitStockCount,
  type TemplateItem,
} from "./actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

interface Material {
  id: string;
  name: string;
  category: string | null;
  stock_unit: string;
  par_level: number;
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

type Feedback = { type: "error" | "success"; text: string } | null;

export default function StockCountForm({ materials, departments, storeDeptId, stock }: Props) {
  const router = useRouter();
  const [deptId, setDeptId] = useState(storeDeptId);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [savePending, startSave] = useTransition();
  const [syncPending, startSync] = useTransition();

  const systemFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stock)
      if (s.department_id === deptId) m.set(s.raw_material_id, Number(s.current_stock));
    return m;
  }, [stock, deptId]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q
      ? materials.filter((m) => m.name.toLowerCase().includes(q))
      : materials;
    const map = new Map<string, Material[]>();
    for (const m of visible) {
      const cat = m.category ?? "Uncategorised";
      const arr = map.get(cat) ?? [];
      arr.push(m);
      map.set(cat, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [materials, query]);

  const enteredCount = Object.values(actuals).filter((v) => v.trim() !== "").length;

  function setActual(id: string, value: string) {
    setActuals((a) => ({ ...a, [id]: value }));
  }
  function step(id: string, delta: number) {
    setActuals((a) => {
      const cur = Number(a[id] ?? "") || 0;
      const next = Math.max(0, cur + delta);
      return { ...a, [id]: String(next) };
    });
  }
  function fillAllToPar() {
    // Only fill items currently VISIBLE under the search filter; preserve counts
    // already entered for hidden items rather than silently writing all of them.
    const q = query.trim().toLowerCase();
    const visible = q ? materials.filter((m) => m.name.toLowerCase().includes(q)) : materials;
    setActuals((a) => {
      const next = { ...a };
      for (const m of visible) next[m.id] = String(m.par_level);
      return next;
    });
  }
  function changeDept(id: number) {
    setDeptId(id);
    setActuals({});
    setFeedback(null);
  }

  function save() {
    setFeedback(null);
    const items = materials
      .filter((m) => (actuals[m.id] ?? "").trim() !== "")
      .map((m) => ({ rawMaterialId: m.id, actualQty: Number(actuals[m.id]) || 0 }));
    if (items.length === 0) {
      setFeedback({ type: "error", text: "Enter at least one count." });
      return;
    }
    // Flag massive variances and confirm BEFORE saving.
    const flagged = items.filter((i) => {
      const sys = systemFor.get(i.rawMaterialId) ?? 0;
      return sys > 0 && Math.abs(i.actualQty - sys) / sys > 0.3;
    });
    if (flagged.length > 0) {
      const names = flagged
        .slice(0, 4)
        .map((f) => materials.find((m) => m.id === f.rawMaterialId)?.name)
        .filter(Boolean)
        .join(", ");
      const ok = window.confirm(
        `${flagged.length} item(s) differ from system stock by more than 30% (${names}${flagged.length > 4 ? "…" : ""}). Save anyway?`,
      );
      if (!ok) return;
    }
    startSave(async () => {
      const res = await submitStockCount(deptId, items);
      if (res.error) return setFeedback({ type: "error", text: res.error });
      setFeedback({
        type: "success",
        text: `${res.success}${res.flagged ? ` ${res.flagged} flagged variance(s).` : ""}`,
      });
      void triggerSheetSync(); // mirror the count + reconciliation to the sheet
      setActuals({});
      router.refresh();
    });
  }

  function pushTemplate() {
    setFeedback(null);
    const deptName = departments.find((d) => d.id === deptId)?.name ?? "";
    const items: TemplateItem[] = materials.map((m) => ({
      name: m.name,
      unit: m.stock_unit,
      system: systemFor.get(m.id) ?? 0,
      par: m.par_level,
    }));
    startSync(async () => {
      const res = await pushStockTemplate(deptName, items);
      setFeedback(res.error ? { type: "error", text: res.error } : { type: "success", text: res.success ?? "" });
    });
  }

  function pull() {
    setFeedback(null);
    startSync(async () => {
      const res = await pullStockCount(deptId);
      if (res.error) return setFeedback({ type: "error", text: res.error });
      setFeedback({ type: "success", text: res.success ?? "" });
      router.refresh();
    });
  }

  const inputCls =
    "w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200 [color-scheme:light]";

  return (
    <div className="mx-auto max-w-lg pb-28 lg:max-w-6xl">
      {/* Sticky controls — stack on mobile, single dense row on laptop */}
      <div className="sticky top-0 z-10 rounded-lg border border-[#e6e0d3] bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select value={deptId} onChange={(e) => changeDept(Number(e.target.value))} className={`${inputCls} min-w-[10rem] flex-1`}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items…"
            className={`${inputCls} min-w-[10rem] flex-1`}
          />
          <button type="button" onClick={fillAllToPar} className={GHOST_BUTTON}>
            Fill all to PAR
          </button>
          <button type="button" onClick={pull} disabled={syncPending} className={GHOST_BUTTON}>
            {syncPending ? "Syncing…" : "Pull from Sheet"}
          </button>
          <button type="button" onClick={pushTemplate} disabled={syncPending} className={GHOST_BUTTON}>
            Push template
          </button>
        </div>
        {feedback && (
          <p
            role={feedback.type === "error" ? "alert" : "status"}
            className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
              feedback.type === "error"
                ? "border-red-200 bg-red-50 text-red-600"
                : "border-emerald-200 bg-emerald-50 text-emerald-600"
            }`}
          >
            {feedback.text}
          </p>
        )}
      </div>

      {/* Grouped item list */}
      <div className="mt-4 space-y-5">
        {grouped.map(([category, items]) => (
          <section key={category}>
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-widest text-indigo-600/70">
              {category}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((m) => {
                const sys = systemFor.get(m.id) ?? 0;
                const actual = actuals[m.id] ?? "";
                const below = (Number(actual) || 0) < m.par_level && actual !== "";
                return (
                  <div key={m.id} className="flex items-center gap-3 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-900">{m.name}</p>
                      <p className="text-[11px] text-neutral-500">
                        System: <span className="tabular-nums text-neutral-700">{sys} {m.stock_unit}</span>
                        <span className="mx-1.5">·</span>PAR: <span className="tabular-nums">{m.par_level}</span>
                        {below && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">LOW</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => step(m.id, -1)}
                        className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#d9d1c1] bg-white text-lg text-neutral-700 transition hover:bg-[#efe9dd] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label={`Decrease ${m.name}`}
                      >
                        −
                      </button>
                      <input
                        inputMode="decimal"
                        value={actual}
                        onChange={(e) => setActual(m.id, e.target.value)}
                        placeholder="0"
                        className="h-11 w-16 rounded-lg border border-[#d9d1c1] bg-white text-center text-base font-semibold tabular-nums text-neutral-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                      />
                      <button
                        type="button"
                        onClick={() => step(m.id, 1)}
                        className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#d9d1c1] bg-white text-lg text-neutral-700 transition hover:bg-[#efe9dd] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label={`Increase ${m.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {grouped.length === 0 && (
          <p className="py-10 text-center text-sm text-neutral-500">No items match.</p>
        )}
      </div>

      {/* Sticky submit */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e6e0d3] bg-white p-4"
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <p className="flex-1 text-sm text-neutral-600">
            <span className="font-semibold text-neutral-900">{enteredCount}</span> item{enteredCount === 1 ? "" : "s"} counted
          </p>
          <button type="button" onClick={save} disabled={savePending || enteredCount === 0} className={`${PRIMARY_BUTTON} px-6`}>
            {savePending ? "Saving…" : "Submit Count"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
