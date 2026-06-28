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
} from "./ui";
import type {
  DepartmentOption,
  LiveStockRow,
  RawMaterialOption,
} from "./types";

interface Props {
  supabase: SupabaseClient;
  materials: RawMaterialOption[];
  /** Departments other than Store (issue destinations). */
  targetDepartments: DepartmentOption[];
  storeDeptId: number;
  /** Current stock rows, to surface availability at Store. */
  stock: LiveStockRow[];
}

export default function IssueForm({
  supabase,
  materials,
  targetDepartments,
  storeDeptId,
  stock,
}: Props) {
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [targetDeptId, setTargetDeptId] = useState(
    targetDepartments[0]?.id ? String(targetDepartments[0].id) : "",
  );
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const material = useMemo(
    () => materials.find((m) => m.id === materialId) ?? null,
    [materials, materialId],
  );

  // Available stock for this material at the Store department.
  const available = useMemo(() => {
    if (!materialId) return null;
    const row = stock.find(
      (s) => s.raw_material_id === materialId && s.department_id === storeDeptId,
    );
    return row ? Number(row.current_stock) : 0;
  }, [stock, materialId, storeDeptId]);

  const qtyNum = Number(qty) || 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (!materialId) return setFeedback({ type: "error", message: "Select a raw material." });
    if (qtyNum <= 0) return setFeedback({ type: "error", message: "Quantity must be greater than zero." });
    if (!targetDeptId) return setFeedback({ type: "error", message: "Select a target department." });

    setPending(true);
    // Two-sided ledger row: debits Store (from_department) and credits the
    // target (to_department). The live_stock view negates from_department, so
    // quantity is the POSITIVE magnitude moved.
    const { error } = await supabase.from("inventory_ledger").insert({
      raw_material_id: materialId,
      from_department_id: storeDeptId,
      to_department_id: Number(targetDeptId),
      type: "ISSUE_TO_KITCHEN",
      quantity: qtyNum,
    });
    setPending(false);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      return;
    }
    void triggerSheetSync(); // best-effort mirror to the location's sheet
    const dept = targetDepartments.find((d) => d.id === Number(targetDeptId));
    setFeedback({
      type: "success",
      message: `Issued ${qtyNum} ${material?.stock_unit ?? ""} to ${dept?.name ?? "department"}.`,
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
        <Field label="Target department">
          <select
            value={targetDeptId}
            onChange={(e) => setTargetDeptId(e.target.value)}
            className={inputCls}
          >
            {targetDepartments.map((d) => (
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
            qtyNum > available
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-[#e6e0d3] bg-[#f7f3ec] text-neutral-600"
          }`}
        >
          Available at Store:{" "}
          <span className="font-semibold tabular-nums text-neutral-900">
            {available} {material.stock_unit}
          </span>
          {qtyNum > available && " — issuing more will drive stock negative."}
        </div>
      )}

      <FormFeedback feedback={feedback} />
      <SubmitButton pending={pending} pendingLabel="Issuing…">
        Issue stock
      </SubmitButton>
    </form>
  );
}
