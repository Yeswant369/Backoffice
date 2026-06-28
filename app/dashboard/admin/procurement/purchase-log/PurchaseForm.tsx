"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/format";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "@/app/dashboard/_components/forms";
import { logPurchase } from "../actions";

interface Option {
  id: string;
  name: string;
  vendor_code?: string;
  stock_unit?: string;
}

interface Props {
  vendors: Option[];
  materials: Option[];
  /** Pre-fill from the Reorder engine deep-link (one-click purchase). */
  initial?: {
    vendorId?: string;
    materialId?: string;
    qty?: string;
    price?: string;
  };
}

/** Today's date in the location's timezone (IST), as a YYYY-MM-DD input value. */
const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );

export default function PurchaseForm({ vendors, materials, initial }: Props) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [materialId, setMaterialId] = useState(initial?.materialId ?? "");
  const [qty, setQty] = useState(initial?.qty ?? "");
  const [price, setPrice] = useState(initial?.price ?? "");
  const [purchaseDate, setPurchaseDate] = useState(todayIST);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const material = useMemo(
    () => materials.find((m) => m.id === materialId),
    [materials, materialId],
  );
  const lineTotal = (Number(qty) || 0) * (Number(price) || 0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setFeedback(null);
    setPending(true);

    const res = await logPurchase(undefined, new FormData(form));
    if (res.error) {
      setFeedback({ type: "error", message: res.error });
      setPending(false);
      return;
    }

    const sync = await triggerSheetSync();
    setFeedback({
      type: "success",
      message: sync.ok
        ? `${res.success} Synced to Purchase Log.`
        : `${res.success} (Sheet sync: ${sync.error})`,
    });
    form.reset();
    setVendorId("");
    setMaterialId("");
    setQty("");
    setPrice("");
    setPurchaseDate(todayIST());
    setPending(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">Log a purchase</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice date" hint="When the purchase actually happened">
          <input
            name="purchase_date"
            type="date"
            required
            max={todayIST()}
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Vendor">
          <select
            name="vendor_id"
            required
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className={inputCls}
          >
            <option value="" disabled>
              Select vendor…
            </option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.vendor_code ? ` (${v.vendor_code})` : ""}
              </option>
            ))}
          </select>
        </Field>
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
        <Field
          label="Quantity"
          hint={material?.stock_unit ? `In ${material.stock_unit}` : undefined}
        >
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
        <Field label="Unit price" hint="₹ per stock unit">
          <input
            name="unit_price"
            type="number"
            step="any"
            min="0"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      {lineTotal > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-4 py-3 text-sm">
          <span className="text-neutral-600">Line total</span>
          <span className="font-semibold tabular-nums text-neutral-900">
            {inr(lineTotal)}
          </span>
        </div>
      )}

      <FormFeedback feedback={feedback} />
      <div className="sm:max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Logging…">
          Log purchase
        </SubmitButton>
      </div>
    </form>
  );
}
