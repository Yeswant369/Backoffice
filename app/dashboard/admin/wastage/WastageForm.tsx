"use client";

import { useActionState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../_components/forms";
import Combobox from "../../_components/Combobox";
import { recordDeptWastage, type ActionState } from "../inventory/actions";
import { triggerSheetSync } from "@/lib/sheet-sync-client";

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

export default function WastageForm({
  departments,
  materials,
}: {
  departments: Dept[];
  materials: Material[];
}) {
  const router = useRouter();
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      ),
    [],
  );
  const [state, formAction, pending] = useActionState<
    ActionState | undefined,
    FormData
  >(recordDeptWastage, undefined);

  // Mirror the fresh WASTAGE row to the sheet and re-fetch the recent list.
  useEffect(() => {
    if (state?.token) {
      void triggerSheetSync();
      router.refresh();
    }
  }, [state?.token, router]);

  const feedback: Feedback | null = state?.error
    ? { type: "error", message: state.error }
    : state?.success
      ? { type: "success", message: state.success }
      : null;

  return (
    // key remount per success — form.reset() can't clear Combobox state, and a
    // lingering material must never be silently inherited by the next entry.
    <form
      key={state?.token ?? "init"}
      action={formAction}
      className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <h3 className="text-sm font-semibold text-neutral-900">Record wastage</h3>
      {departments.length === 0 || materials.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Add departments and raw materials first.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department">
              <select
                name="department_id"
                required
                defaultValue=""
                className={inputCls}
              >
                <option value="" disabled>
                  Select department…
                </option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Raw material">
              <Combobox
                name="raw_material_id"
                required
                placeholder="Type to search…"
                options={materials.map((m) => ({
                  id: m.id,
                  label: m.name,
                  hint: m.code ?? m.stock_unit,
                }))}
              />
            </Field>
            <Field label="Quantity">
              <input
                name="quantity"
                type="number"
                step="any"
                min="0"
                required
                className={inputCls}
              />
            </Field>
            <Field label="Wastage date">
              <input
                name="waste_date"
                type="date"
                defaultValue={today}
                max={today}
                required
                className={inputCls}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Reason">
                <input
                  name="reason"
                  type="text"
                  required
                  placeholder="Spoiled, burnt, spillage…"
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
          <FormFeedback feedback={feedback} />
          <div className="sm:max-w-xs">
            <SubmitButton pending={pending} pendingLabel="Recording…">
              Record wastage
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
