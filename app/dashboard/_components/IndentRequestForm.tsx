"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "./forms";
import Combobox from "./Combobox";
import {
  createPurchaseOrder,
  type PoState,
} from "@/app/dashboard/admin/procurement/po-actions";

interface Props {
  departments: { id: number; name: string }[];
  materials: { id: string; name: string; code: string | null; stock_unit: string }[];
  /** Lock the requesting department (e.g. the Kitchen dashboard) — hides the select. */
  fixedDepartmentId?: number;
}

interface Line {
  key: number;
  materialId: string;
  qty: string;
  price: string;
}

/**
 * Indent-only request form (Store → department) for staff dashboards. Raises a
 * PENDING purchase_orders row of kind INDENT via createPurchaseOrder; an
 * admin/manager approves and the Store dispatches. Field state lives in the
 * keyed inner component so a successful submit remounts to a clean form.
 */
export default function IndentRequestForm(props: Props) {
  const [state, formAction, pending] = useActionState<PoState | undefined, FormData>(
    createPurchaseOrder,
    undefined,
  );

  const feedback: Feedback | null = state?.error
    ? { type: "error", message: state.error }
    : state?.success
      ? { type: "success", message: state.success }
      : null;

  return (
    <FormFields
      key={state?.token ?? "init"}
      {...props}
      formAction={formAction}
      pending={pending}
      feedback={feedback}
    />
  );
}

function FormFields({
  departments,
  materials,
  fixedDepartmentId,
  formAction,
  pending,
  feedback,
}: Props & {
  formAction: (fd: FormData) => void;
  pending: boolean;
  feedback: Feedback | null;
}) {
  const nextKey = useRef(1);
  const [lines, setLines] = useState<Line[]>([
    { key: 0, materialId: "", qty: "", price: "" },
  ]);

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
  // Indents move stock OUT of the Store — never let Store request from itself.
  const indentDepartments = useMemo(
    () => departments.filter((d) => d.name.trim().toLowerCase() !== "store"),
    [departments],
  );

  const linesJson = JSON.stringify(
    lines
      .filter((l) => l.materialId || l.qty || l.price)
      .map((l) => ({
        raw_material_id: l.materialId,
        requested_qty: Number(l.qty),
        expected_unit_price: l.price === "" ? null : Number(l.price),
      })),
  );

  function patchLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">
        Request stock (indent)
      </h3>
      <p className="text-xs text-neutral-500">
        Raises a PENDING indent for admin/manager approval — the Store dispatches
        approved stock to the department.
      </p>

      {fixedDepartmentId != null ? (
        <input type="hidden" name="to_department_id" value={fixedDepartmentId} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Requesting department" hint="stock moves Store → here">
            <select
              name="to_department_id"
              required
              defaultValue=""
              className={inputCls}
            >
              <option value="" disabled>
                Select a department…
              </option>
              {indentDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="space-y-3">
        {lines.map((l, i) => {
          const mat = materialById.get(l.materialId);
          return (
            <div
              key={l.key}
              className="grid gap-3 rounded-lg border border-[#e6e0d3] bg-white p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
            >
              <Field label={i === 0 ? "Material" : ""}>
                <Combobox
                  name={`material_${l.key}`}
                  value={l.materialId}
                  onChange={(id) => patchLine(l.key, { materialId: id })}
                  placeholder="Type to search materials…"
                  options={materialOptions}
                />
              </Field>
              <Field
                label={
                  i === 0
                    ? `Requested qty${mat?.stock_unit ? ` (${mat.stock_unit})` : ""}`
                    : ""
                }
              >
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={l.qty}
                  onChange={(e) => patchLine(l.key, { qty: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label={i === 0 ? "Expected price (₹, optional)" : ""}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={l.price}
                  onChange={(e) => patchLine(l.key, { price: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <div className="flex items-end pb-0.5">
                <button
                  type="button"
                  aria-label="Remove line"
                  onClick={() =>
                    setLines((ls) =>
                      ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls,
                    )
                  }
                  disabled={lines.length === 1}
                  className="rounded-lg border border-[#e6e0d3] px-2.5 py-2 text-neutral-500 transition hover:text-red-600 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              { key: nextKey.current++, materialId: "", qty: "", price: "" },
            ])
          }
          className="rounded-lg border border-dashed border-[#cdc4b1] px-3 py-2 text-sm font-medium text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-900"
        >
          + Add line
        </button>
      </div>

      <Field label="Notes" hint="Optional">
        <textarea name="notes" rows={2} className={inputCls} />
      </Field>

      {/* The action reads one JSON payload, not per-line fields. */}
      <input type="hidden" name="lines" value={linesJson} />

      <FormFeedback feedback={feedback} />
      <div className="sm:max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Submitting…">
          Submit indent
        </SubmitButton>
      </div>
    </form>
  );
}
