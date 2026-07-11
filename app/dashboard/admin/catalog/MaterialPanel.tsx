"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../_components/forms";
import Combobox from "../../_components/Combobox";
import {
  createRawMaterial,
  deleteRawMaterial,
  type CatalogState,
} from "./actions";
import DeleteButton from "./DeleteButton";
import CategoryManager from "./CategoryManager";
import MaterialClassifyCell from "./MaterialClassifyCell";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import RawMaterialsWorkspace from "./RawMaterialsWorkspace";
import type { CategoryOption, MaterialRow, VendorOption } from "./types";

const TYPE_TABS = [
  { key: "INGREDIENT", label: "Ingredients" },
  { key: "OPERATIONAL", label: "Operational" },
] as const;

type MaterialType = (typeof TYPE_TABS)[number]["key"];

interface Props {
  materials: MaterialRow[];
  vendors: VendorOption[];
  materialCategories: CategoryOption[];
  connected: boolean;
  sheetUrl: string;
}

export default function MaterialPanel({
  materials,
  vendors,
  materialCategories,
  connected,
  sheetUrl,
}: Props) {
  const [typeTab, setTypeTab] = useState<MaterialType>("INGREDIENT");
  const [state, formAction, pending] = useActionState<
    CatalogState | undefined,
    FormData
  >(createRawMaterial, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.token) {
      formRef.current?.reset();
      void triggerSheetSync();
    }
  }, [state?.token]);

  const feedback: Feedback | null = state?.error
    ? { type: "error", message: state.error }
    : state?.success
      ? { type: "success", message: state.success }
      : null;

  const counts = useMemo(() => {
    const c: Record<MaterialType, number> = { INGREDIENT: 0, OPERATIONAL: 0 };
    for (const m of materials) {
      if (m.material_type === "OPERATIONAL") c.OPERATIONAL += 1;
      else c.INGREDIENT += 1;
    }
    return c;
  }, [materials]);

  const visibleMaterials = useMemo(
    () =>
      materials.filter((m) =>
        typeTab === "OPERATIONAL"
          ? m.material_type === "OPERATIONAL"
          : m.material_type !== "OPERATIONAL",
      ),
    [materials, typeTab],
  );

  return (
    <div className="space-y-6">
      {/* Ingredients | Operational split — filters the table below. */}
      <div className="flex gap-1 rounded-lg bg-[#efe9dd] p-1">
        {TYPE_TABS.map((t) => {
          const active = typeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTypeTab(t.key)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                active
                  ? "bg-white text-neutral-950 shadow-sm"
                  : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {t.label}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                  active ? "bg-[#efe9dd] text-neutral-600" : "bg-white/60 text-neutral-500"
                }`}
              >
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>

      <RawMaterialsWorkspace connected={connected} sheetUrl={sheetUrl} />

      {/* key remount per success — form.reset() can't clear the vendor
          Combobox's state, and a lingering vendor would silently attach to
          every subsequent material. */}
      <form
        key={state?.token ?? "init"}
        ref={formRef}
        action={formAction}
        className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
      >
        <h3 className="text-sm font-semibold text-neutral-900">Add raw material</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <div className="flex gap-1 rounded-lg bg-[#efe9dd] p-1">
              {TYPE_TABS.map((t) => (
                <label key={t.key} className="flex-1 cursor-pointer">
                  <input
                    type="radio"
                    name="material_type"
                    value={t.key}
                    defaultChecked={t.key === "INGREDIENT"}
                    className="peer sr-only"
                  />
                  <span className="block rounded-lg px-3 py-2 text-center text-sm font-medium text-neutral-600 transition peer-checked:bg-white peer-checked:text-neutral-950 peer-checked:shadow-sm">
                    {t.key === "INGREDIENT" ? "Ingredient" : "Operational"}
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Name">
            <input name="name" required placeholder="Basmati Rice" className={inputCls} />
          </Field>
          <Field label="Code" hint="Leave blank to auto-number">
            <input name="code" placeholder="auto e.g. RM-0012" className={inputCls} />
          </Field>
          <Field label="Brand" hint="Optional">
            <input name="brand" placeholder="India Gate" className={inputCls} />
          </Field>
          <Field label="Purchase unit" hint="How you buy it">
            <input name="purchase_unit" required placeholder="Sack" className={inputCls} />
          </Field>
          <Field label="Stock unit" hint="How you store it">
            <input name="stock_unit" required placeholder="kg" className={inputCls} />
          </Field>
          <Field label="Conversion factor" hint="1 purchase unit = N stock units">
            <input
              name="conversion_factor"
              type="number"
              step="any"
              min="0"
              defaultValue="1"
              required
              className={inputCls}
            />
          </Field>
          <Field label="Par level" hint="Reorder threshold (stock units)">
            <input
              name="par_level"
              type="number"
              step="any"
              min="0"
              defaultValue="0"
              className={inputCls}
            />
          </Field>
          <Field label="Category" hint="Optional — manage the list below">
            <select name="category_id" defaultValue="" className={inputCls}>
              <option value="">— none —</option>
              {materialCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default vendor" hint="Optional">
            <Combobox
              name="vendor_id"
              placeholder="Type to search…"
              options={vendors.map((v) => ({
                id: v.id,
                label: v.name,
                hint: v.vendor_code,
              }))}
            />
          </Field>
        </div>
        <FormFeedback feedback={feedback} />
        <div className="sm:max-w-xs">
          <SubmitButton pending={pending} pendingLabel="Creating…">
            Create material
          </SubmitButton>
        </div>
      </form>

      <CategoryManager
        kind="material"
        categories={materialCategories}
        title="Material categories"
      />

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            {typeTab === "OPERATIONAL" ? "Operational materials" : "Ingredients"}{" "}
            <span className="ml-1 text-neutral-500">{visibleMaterials.length}</span>
          </h3>
        </div>
        {visibleMaterials.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No {typeTab === "OPERATIONAL" ? "operational materials" : "ingredients"} yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-2.5 font-medium">Material</th>
                <th className="px-5 py-2.5 font-medium">Code</th>
                <th className="px-5 py-2.5 font-medium">Type / Category</th>
                <th className="px-5 py-2.5 font-medium">Units</th>
                <th className="px-5 py-2.5 text-right font-medium">Par</th>
                <th className="px-5 py-2.5 font-medium">Vendor</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleMaterials.map((m) => (
                <tr key={m.id} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/admin/materials/${m.id}`}
                        className="font-medium text-indigo-700 hover:text-indigo-500"
                      >
                        {m.name}
                      </Link>
                      {m.needs_review && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          Review
                        </span>
                      )}
                    </div>
                    {m.brand && (
                      <div className="text-[11px] text-neutral-500">{m.brand}</div>
                    )}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-neutral-600">
                    {m.code ?? "—"}
                  </td>
                  <td className="px-5 py-2.5">
                    <MaterialClassifyCell
                      materialId={m.id}
                      materialType={m.material_type}
                      categoryId={m.category_id}
                      categories={materialCategories}
                    />
                    {!m.category_id && m.category && (
                      <div className="mt-0.5 text-[11px] text-neutral-500">
                        sheet: {m.category}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-neutral-600">
                    1 {m.purchase_unit} = {m.conversion_factor} {m.stock_unit}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
                    {m.par_level} {m.stock_unit}
                  </td>
                  <td className="px-5 py-2.5 text-neutral-600">
                    {m.vendor_name ?? "—"}
                  </td>
                  <td className="px-5 py-2.5">
                    <DeleteButton
                      id={m.id}
                      action={deleteRawMaterial}
                      confirmMessage={`Delete material "${m.name}"?`}
                      syncOnSuccess
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
