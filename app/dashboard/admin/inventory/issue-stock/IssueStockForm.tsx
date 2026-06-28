"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "@/app/dashboard/_components/forms";
import { issueStock } from "../actions";

interface Material {
  id: string;
  name: string;
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

export default function IssueStockForm({
  materials,
  departments,
  storeDeptId,
  stock,
}: Props) {
  const router = useRouter();
  const [materialId, setMaterialId] = useState("");
  const [fromId, setFromId] = useState(String(storeDeptId));
  const [toId, setToId] = useState("");
  const [qty, setQty] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const material = useMemo(
    () => materials.find((m) => m.id === materialId),
    [materials, materialId],
  );

  const available = useMemo(() => {
    if (!materialId || !fromId) return null;
    const row = stock.find(
      (s) =>
        s.raw_material_id === materialId && s.department_id === Number(fromId),
    );
    return row ? Number(row.current_stock) : 0;
  }, [stock, materialId, fromId]);

  const qtyNum = Number(qty) || 0;
  const exceeds = available !== null && qtyNum > available;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setFeedback(null);

    if (exceeds) {
      setFeedback({
        type: "error",
        message: `Quantity exceeds available stock (${available} ${material?.stock_unit ?? ""}).`,
      });
      return;
    }

    setPending(true);
    const res = await issueStock(undefined, new FormData(form));
    if (res.error) {
      setFeedback({ type: "error", message: res.error });
      setPending(false);
      return;
    }

    const sync = await triggerSheetSync();
    setFeedback({
      type: "success",
      message: sync.ok
        ? `${res.success} Synced to the Issues tab.`
        : `${res.success} (Sheet sync: ${sync.error})`,
    });
    form.reset();
    setMaterialId("");
    setQty("");
    setToId("");
    setFromId(String(storeDeptId));
    setPending(false);
    router.refresh();
  }

  const targets = departments.filter((d) => d.id !== Number(fromId));

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">Issue stock</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Raw material">
          <select
            name="raw_material_id"
            required
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            className={inputCls}
          >
            <option value="" disabled>
              Select material…
            </option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" hint={material?.stock_unit ? `In ${material.stock_unit}` : undefined}>
          <input
            name="quantity"
            type="number"
            step="any"
            min="0"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="From department">
          <select
            name="from_department_id"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
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
      </div>

      {material && available !== null && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            exceeds
              ? "border-red-200 bg-red-50 text-red-600"
              : "border-[#e6e0d3] bg-[#f7f3ec] text-neutral-600"
          }`}
        >
          Available in source:{" "}
          <span className="font-semibold tabular-nums text-neutral-900">
            {available} {material.stock_unit}
          </span>
          {exceeds && " — quantity exceeds available stock."}
        </div>
      )}

      <FormFeedback feedback={feedback} />
      <div className="sm:max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Issuing…">
          Issue stock
        </SubmitButton>
      </div>
    </form>
  );
}
