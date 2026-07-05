"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inr, formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import {
  Field,
  FormFeedback,
  inputCls,
  type Feedback,
} from "@/app/dashboard/_components/forms";
import Combobox from "@/app/dashboard/_components/Combobox";
import { logPurchaseBill } from "../actions";

interface Option {
  id: string;
  name: string;
  vendor_code?: string;
  stock_unit?: string;
  code?: string | null;
}

interface Props {
  vendors: Option[];
  materials: Option[];
  /** The caller's home location — storage photos live under this folder. */
  locationId: string;
  /** Pre-fill from the Reorder engine deep-link (one-click purchase). */
  initial?: {
    vendorId?: string;
    materialId?: string;
    qty?: string;
    price?: string;
  };
}

interface Line {
  key: number;
  materialId: string;
  qty: string;
  price: string;
  /** Last purchased price hint: undefined = not fetched, null = never bought. */
  last?: { price: number; date: string; vendor: string } | null;
}

/** Today's date in the location's timezone (IST), as a YYYY-MM-DD input value. */
const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );

/**
 * Cart-style purchase entry: pick the vendor ONCE, add every line on the bill,
 * attach the bill + delivered-goods photos, submit once. Each material shows
 * its last purchased price as you pick it.
 */
export default function PurchaseForm({ vendors, materials, locationId, initial }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const nextKey = useRef(1);

  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayIST);
  const [lines, setLines] = useState<Line[]>([
    {
      key: 0,
      materialId: initial?.materialId ?? "",
      qty: initial?.qty ?? "",
      price: initial?.price ?? "",
    },
  ]);
  const [billPhoto, setBillPhoto] = useState<File | null>(null);
  const [deliveryPhoto, setDeliveryPhoto] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const billPhotoRef = useRef<HTMLInputElement>(null);
  const deliveryPhotoRef = useRef<HTMLInputElement>(null);

  const materialById = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );
  const materialOptions = useMemo(
    () =>
      materials.map((m) => ({
        id: m.id,
        label: m.name,
        hint: m.code ?? m.stock_unit ?? "",
      })),
    [materials],
  );
  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ id: v.id, label: v.name, hint: v.vendor_code })),
    [vendors],
  );

  const total = lines.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0),
    0,
  );

  function patchLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((ls) => [
      ...ls,
      { key: nextKey.current++, materialId: "", qty: "", price: "" },
    ]);
  }

  function removeLine(key: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  }

  // Last purchased price hint, fetched when a line's material changes. The
  // patch is applied ONLY if the line still shows the material the fetch was
  // issued for — otherwise a slow response could label material B with
  // material A's price (stale-fetch race).
  function patchLineIfMaterial(
    key: number,
    materialId: string,
    last: Line["last"],
  ) {
    setLines((ls) =>
      ls.map((l) =>
        l.key === key && l.materialId === materialId ? { ...l, last } : l,
      ),
    );
  }

  async function onPickMaterial(key: number, materialId: string) {
    patchLine(key, { materialId, last: undefined });
    if (!materialId) return;
    const { data } = await supabase
      .from("inventory_ledger")
      .select("unit_price, transaction_date, created_at, vendors ( name )")
      .eq("raw_material_id", materialId)
      .eq("location_id", locationId)
      .eq("type", "PURCHASE")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      patchLineIfMaterial(key, materialId, null);
      return;
    }
    const v = data.vendors as unknown as { name: string } | null;
    patchLineIfMaterial(key, materialId, {
      price: Number(data.unit_price ?? 0),
      date: (data.transaction_date as string | null) ?? (data.created_at as string),
      vendor: v?.name ?? "—",
    });
  }

  async function uploadPhoto(file: File, kind: "bill" | "delivery"): Promise<string> {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
    const path = `${locationId}/${crypto.randomUUID()}/${kind}.${ext}`;
    const { error } = await supabase.storage
      .from("purchase-photos")
      .upload(path, file, { contentType: file.type || "image/jpeg" });
    if (error) throw new Error(`Photo upload failed: ${error.message}`);
    return path;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);

    if (!vendorId) return setFeedback({ type: "error", message: "Select a vendor." });
    const filled = lines.filter((l) => l.materialId || l.qty || l.price);
    if (filled.length === 0)
      return setFeedback({ type: "error", message: "Add at least one line item." });
    for (const l of filled) {
      if (!l.materialId)
        return setFeedback({ type: "error", message: "Every line needs a material." });
      if (!(Number(l.qty) > 0))
        return setFeedback({ type: "error", message: "Every quantity must be greater than zero." });
      if (Number(l.price) < 0)
        return setFeedback({ type: "error", message: "Unit prices cannot be negative." });
    }

    setPending(true);
    try {
      // 1. Photos go straight to storage (per-location folder, RLS-enforced).
      const [billPath, deliveryPath] = await Promise.all([
        billPhoto ? uploadPhoto(billPhoto, "bill") : Promise.resolve(null),
        deliveryPhoto ? uploadPhoto(deliveryPhoto, "delivery") : Promise.resolve(null),
      ]);

      // 2. One server-action call records the bill + all its ledger lines.
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("invoice_no", invoiceNo);
      fd.set("purchase_date", purchaseDate);
      if (billPath) fd.set("bill_photo_path", billPath);
      if (deliveryPath) fd.set("delivery_photo_path", deliveryPath);
      fd.set(
        "lines",
        JSON.stringify(
          filled.map((l) => ({
            raw_material_id: l.materialId,
            quantity: Number(l.qty),
            unit_price: Number(l.price),
          })),
        ),
      );
      const result = await logPurchaseBill(undefined, fd);
      if (result?.error) {
        setFeedback({ type: "error", message: result.error });
        return;
      }

      const sync = await triggerSheetSync();
      setFeedback({
        type: "success",
        message: sync.ok
          ? `${result?.success ?? "Bill logged."} Synced to Purchase Log.`
          : `${result?.success ?? "Bill logged."} (Sheet sync: ${sync.error})`,
      });
      // Reset for the next bill — keep the vendor (suppliers deliver in runs),
      // but snap the date back to today so a backdate never leaks forward.
      setLines([{ key: nextKey.current++, materialId: "", qty: "", price: "" }]);
      setInvoiceNo("");
      setPurchaseDate(todayIST());
      setBillPhoto(null);
      setDeliveryPhoto(null);
      if (billPhotoRef.current) billPhotoRef.current.value = "";
      if (deliveryPhotoRef.current) deliveryPhotoRef.current.value = "";
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

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">Log a purchase bill</h3>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Vendor">
          <Combobox
            name="vendor_id"
            required
            value={vendorId}
            onChange={setVendorId}
            placeholder="Type to search vendors…"
            options={vendorOptions}
          />
        </Field>
        <Field label="Bill / invoice no." hint="as printed on the bill">
          <input
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder="INV-1042"
            className={inputCls}
          />
        </Field>
        <Field label="Bill date">
          <input
            type="date"
            value={purchaseDate}
            max={todayIST()}
            onChange={(e) => setPurchaseDate(e.target.value)}
            required
            className={inputCls}
          />
        </Field>
      </div>

      <div className="space-y-3">
        {lines.map((l, i) => {
          const mat = materialById.get(l.materialId);
          const lineTotal = (Number(l.qty) || 0) * (Number(l.price) || 0);
          return (
            <div key={l.key} className="rounded-lg border border-[#e6e0d3] bg-white p-3">
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Field label={i === 0 ? "Material" : ""}>
                  <Combobox
                    name={`material_${l.key}`}
                    value={l.materialId}
                    onChange={(id) => void onPickMaterial(l.key, id)}
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
                <Field label={i === 0 ? "Unit price (₹)" : ""}>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={l.price}
                    onChange={(e) => patchLine(l.key, { price: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <div className="flex items-end gap-2 pb-0.5">
                  <span className="w-24 text-right text-sm font-semibold tabular-nums text-neutral-900">
                    {inr(lineTotal)}
                  </span>
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
              {l.last !== undefined && l.materialId && (
                <p className="mt-1.5 text-xs text-neutral-500">
                  {l.last ? (
                    <>
                      Last bought @{" "}
                      <span className="font-semibold text-neutral-700">{inr(l.last.price)}</span>{" "}
                      on {formatDate(l.last.date)} from {l.last.vendor}
                    </>
                  ) : (
                    "First purchase of this material."
                  )}
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bill photo" hint="snap the paper bill (optional)">
          <input
            ref={billPhotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setBillPhoto(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-neutral-700"
          />
        </Field>
        <Field label="Delivered items photo" hint="what actually arrived (optional)">
          <input
            ref={deliveryPhotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setDeliveryPhoto(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-neutral-700"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6e0d3] pt-4">
        <p className="text-sm text-neutral-600">
          Bill total{" "}
          <span className="text-base font-semibold tabular-nums text-neutral-900">
            {inr(total)}
          </span>
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {pending ? "Logging…" : "Log bill"}
        </button>
      </div>
      <FormFeedback feedback={feedback} />
    </form>
  );
}
