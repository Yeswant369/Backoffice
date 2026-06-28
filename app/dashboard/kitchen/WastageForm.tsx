"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../_components/forms";
import type { LiveStockRow, RawMaterialOption } from "./types";

// App-level "enum" of wastage reasons (stored in the wastage_reason varchar).
const WASTAGE_REASONS = [
  "Spoilage",
  "Expiry",
  "Breakage",
  "Preparation Error",
  "Contamination",
  "Overproduction",
  "Other",
];

interface Props {
  supabase: SupabaseClient;
  materials: RawMaterialOption[];
  kitchenDeptId: number;
  stock: LiveStockRow[];
}

export default function WastageForm({
  supabase,
  materials,
  kitchenDeptId,
  stock,
}: Props) {
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(WASTAGE_REASONS[0]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const material = useMemo(
    () => materials.find((m) => m.id === materialId) ?? null,
    [materials, materialId],
  );

  const available = useMemo(() => {
    if (!materialId) return null;
    const row = stock.find(
      (s) =>
        s.raw_material_id === materialId && s.department_id === kitchenDeptId,
    );
    return row ? Number(row.current_stock) : 0;
  }, [stock, materialId, kitchenDeptId]);

  const qtyNum = Number(qty) || 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (!materialId) return setFeedback({ type: "error", message: "Select a raw material." });
    if (qtyNum <= 0) return setFeedback({ type: "error", message: "Quantity must be greater than zero." });

    setPending(true);
    // Deduct from Kitchen via from_department_id (positive magnitude).
    const { error } = await supabase.from("inventory_ledger").insert({
      raw_material_id: materialId,
      from_department_id: kitchenDeptId,
      to_department_id: null,
      type: "WASTAGE",
      quantity: qtyNum,
      wastage_reason: reason,
    });
    setPending(false);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      return;
    }
    void triggerSheetSync(); // best-effort mirror to the location's sheet
    setFeedback({
      type: "success",
      message: `Logged ${qtyNum} ${material?.stock_unit ?? ""} wastage (${reason}).`,
    });
    setQty("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Raw material">
        <select
          value={materialId}
          onChange={(e) => setMaterialId(e.target.value)}
          className={inputCls}
        >
          <option value="">Select material…</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.brand ? ` · ${m.brand}` : ""}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Quantity"
          hint={material ? `In ${material.stock_unit}` : "Stock units"}
        >
          <input
            type="number"
            step="any"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            className={inputCls}
          />
        </Field>
        <Field label="Reason">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputCls}
          >
            {WASTAGE_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {material && available !== null && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            qtyNum > available
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-[#e6e0d3] bg-[#f7f3ec] text-neutral-600"
          }`}
        >
          Available at Kitchen:{" "}
          <span className="font-semibold tabular-nums text-neutral-900">
            {available} {material.stock_unit}
          </span>
          {qtyNum > available && " — wasting more will drive stock negative."}
        </div>
      )}

      <FormFeedback feedback={feedback} />
      <SubmitButton pending={pending} pendingLabel="Logging…">
        Log wastage
      </SubmitButton>
    </form>
  );
}
