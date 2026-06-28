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
import type { RawMaterialOption, VendorOption } from "./types";

interface Props {
  supabase: SupabaseClient;
  materials: RawMaterialOption[];
  vendors: VendorOption[];
  storeDeptId: number;
}

export default function LogPurchaseForm({
  supabase,
  materials,
  vendors,
  storeDeptId,
}: Props) {
  const [materialId, setMaterialId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const material = useMemo(
    () => materials.find((m) => m.id === materialId) ?? null,
    [materials, materialId],
  );
  const cf = material?.conversion_factor ?? 1;

  // When a material is picked, default the vendor to its preferred supplier.
  function handleMaterialChange(id: string) {
    setMaterialId(id);
    setVendorId(materials.find((m) => m.id === id)?.vendor_id ?? "");
  }

  const qtyNum = Number(qty) || 0;
  const priceNum = Number(price) || 0;
  const stockToAdd = qtyNum * cf; // purchase units → stock units
  const totalCost = qtyNum * priceNum; // qty(purchase) × price(per purchase unit)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (!materialId) return setFeedback({ type: "error", message: "Select a raw material." });
    if (!vendorId) return setFeedback({ type: "error", message: "Select a vendor." });
    if (qtyNum <= 0) return setFeedback({ type: "error", message: "Quantity must be greater than zero." });
    if (priceNum < 0) return setFeedback({ type: "error", message: "Unit price cannot be negative." });

    setPending(true);
    // Store quantity in STOCK units (× conversion factor) and unit_price PER
    // STOCK unit (÷ conversion factor), so vendor_dues and weighted_average_cost
    // — which compute quantity × unit_price — stay correct.
    const { error } = await supabase.from("inventory_ledger").insert({
      raw_material_id: materialId,
      vendor_id: vendorId,
      from_department_id: null,
      to_department_id: storeDeptId,
      type: "PURCHASE",
      quantity: stockToAdd,
      unit_price: cf ? priceNum / cf : priceNum,
    });
    setPending(false);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      return;
    }
    void triggerSheetSync(); // best-effort mirror to the location's sheet
    setFeedback({
      type: "success",
      message: `Recorded ${stockToAdd} ${material?.stock_unit} into Store.`,
    });
    setQty("");
    setPrice("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Raw material">
        <select
          value={materialId}
          onChange={(e) => handleMaterialChange(e.target.value)}
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
        <Field
          label="Quantity"
          hint={material ? `In ${material.purchase_unit}` : "Purchase units"}
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
        <Field
          label="Unit price"
          hint={material ? `₹ per ${material.purchase_unit}` : "₹ per purchase unit"}
        >
          <input
            type="number"
            step="any"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className={inputCls}
          />
        </Field>
      </div>

      {material && qtyNum > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-4 py-3 text-sm">
          <span className="text-neutral-600">
            Adds{" "}
            <span className="font-semibold text-neutral-900">
              {stockToAdd} {material.stock_unit}
            </span>{" "}
            <span className="text-neutral-500">
              (× {cf} {material.purchase_unit}→{material.stock_unit})
            </span>
          </span>
          <span className="font-semibold tabular-nums text-neutral-900">
            {inr(totalCost)}
          </span>
        </div>
      )}

      <FormFeedback feedback={feedback} />
      <SubmitButton pending={pending} pendingLabel="Recording…">
        Record purchase
      </SubmitButton>
    </form>
  );
}
