"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import {
  FormFeedback,
  SubmitButton,
  type Feedback,
} from "../../_components/forms";
import { saveProductionSheet } from "./actions";

export interface DishLite {
  id: string;
  name: string;
  selling_price: number | null;
}

export interface ExistingDishRow {
  prepared_qty: number;
  sold_qty: number;
  wastage_qty: number;
  staff_meals_qty: number;
  closing_qty: number | null;
  variance: number | null;
  wastage_photo_path: string | null;
}

interface Props {
  locationId: string;
  departmentId: number;
  day: string;
  dishes: DishLite[];
  existing: Record<string, ExistingDishRow>;
  /** Sold portions per recipe for `day` — fallback when no row exists yet. */
  soldMap: Record<string, number>;
  /** Signed URLs (path → url) for already-stored waste photos. */
  photoUrls: Record<string, string>;
}

interface Entry {
  prepared: string;
  staff: string;
  wasted: string;
  closing: string; // blank = leftover not counted
}

const cellCls =
  "w-24 rounded-lg border border-[#d9d1c1] bg-white px-2.5 py-1.5 text-right text-sm tabular-nums text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 [color-scheme:light]";

const numStr = (v: number) => String(Number(v) || 0);
const fmtQty = (v: number) => String(Math.round(v * 1000) / 1000);

export default function DishWorksheet({
  locationId,
  departmentId,
  day,
  dishes,
  existing,
  soldMap,
  photoUrls,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [state, formAction, actionPending] = useActionState(
    saveProductionSheet,
    undefined,
  );
  const [rows, setRows] = useState<Record<string, Entry>>(() => {
    const init: Record<string, Entry> = {};
    for (const d of dishes) {
      const ex = existing[d.id];
      init[d.id] = ex
        ? {
            prepared: numStr(ex.prepared_qty),
            staff: numStr(ex.staff_meals_qty),
            wasted: numStr(ex.wastage_qty),
            closing: ex.closing_qty === null ? "" : numStr(ex.closing_qty),
          }
        : { prepared: "", staff: "", wasted: "", closing: "" };
    }
    return init;
  });
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // After a successful save: mirror to the sheet and re-pull server data.
  const lastToken = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state?.token && state.token !== lastToken.current) {
      lastToken.current = state.token;
      void triggerSheetSync();
      router.refresh();
    }
  }, [state, router]);

  const pending = uploading || actionPending;
  const feedback: Feedback | null = localError
    ? { type: "error", message: localError }
    : state?.error
      ? { type: "error", message: state.error }
      : state?.success
        ? { type: "success", message: state.success }
        : null;

  function patch(id: string, p: Partial<Entry>) {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }));
  }

  // EXACT upload pattern as PurchaseForm, bucket `wastage-photos`.
  async function uploadPhoto(file: File): Promise<string> {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
    const path = `${locationId}/${crypto.randomUUID()}/waste.${ext}`;
    const { error } = await supabase.storage
      .from("wastage-photos")
      .upload(path, file, { contentType: file.type || "image/jpeg" });
    if (error) throw new Error(`Photo upload failed: ${error.message}`);
    return path;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);

    const payload: {
      recipe_id: string;
      prepared_qty: number;
      staff_meals_qty: number;
      wastage_qty: number;
      closing_qty: number | null;
      wastage_photo_path: string | null;
    }[] = [];

    setUploading(true);
    try {
      for (const d of dishes) {
        const entry = rows[d.id];
        const ex = existing[d.id];
        const file = files[d.id] ?? null;
        const prepared = Number(entry?.prepared) || 0;
        const staff = Number(entry?.staff) || 0;
        const wasted = Number(entry?.wasted) || 0;
        const closingBlank = (entry?.closing ?? "").trim() === "";
        const closing = closingBlank ? null : Number(entry?.closing) || 0;
        const touched =
          prepared !== 0 || staff !== 0 || wasted !== 0 || closing !== null || !!file;
        // Skip untouched all-zero rows with no existing record.
        if (!touched && !ex) continue;

        let photoPath = ex?.wastage_photo_path ?? null;
        if (file) photoPath = await uploadPhoto(file);

        payload.push({
          recipe_id: d.id,
          prepared_qty: prepared,
          staff_meals_qty: staff,
          wastage_qty: wasted,
          closing_qty: closing,
          wastage_photo_path: photoPath,
        });
      }
    } catch (err) {
      setUploading(false);
      setLocalError(err instanceof Error ? err.message : "Photo upload failed.");
      return;
    }
    setUploading(false);

    if (payload.length === 0) {
      setLocalError("Nothing to save — enter at least one quantity.");
      return;
    }

    const fd = new FormData();
    fd.set("production_date", day);
    fd.set("department_id", String(departmentId));
    fd.set("rows", JSON.stringify(payload));
    startTransition(() => formAction(fd));
  }

  return (
    <form
      onSubmit={onSubmit}
      className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]"
    >
      <div className="border-b border-[#e6e0d3] px-5 py-4">
        <h2 className="text-sm font-semibold text-neutral-900">Dish worksheet</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Sold is auto-derived from the day&apos;s POS + manual sales — you never type
          it. Leave Closing blank if the leftover wasn&apos;t counted.
        </p>
      </div>

      {dishes.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-neutral-500">
          No dishes in this department yet — assign dishes a department in Recipe
          Builder.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Dish</th>
                <th className="px-3 py-3 text-right font-medium">Prepared</th>
                <th className="px-3 py-3 text-right font-medium">Sold</th>
                <th className="px-3 py-3 text-right font-medium">Staff meals</th>
                <th className="px-3 py-3 text-right font-medium">Wasted</th>
                <th className="px-3 py-3 text-right font-medium">Waste 📷</th>
                <th className="px-3 py-3 text-right font-medium">Closing</th>
                <th className="px-5 py-3 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {dishes.map((d) => {
                const entry = rows[d.id] ?? {
                  prepared: "",
                  staff: "",
                  wasted: "",
                  closing: "",
                };
                const ex = existing[d.id];
                const file = files[d.id] ?? null;
                const sold = ex ? ex.sold_qty : (soldMap[d.id] ?? 0);
                const closingBlank = entry.closing.trim() === "";
                const variance =
                  (Number(entry.prepared) || 0) -
                  sold -
                  (Number(entry.staff) || 0) -
                  (Number(entry.wasted) || 0) -
                  (closingBlank ? 0 : Number(entry.closing) || 0);
                const photoUrl = ex?.wastage_photo_path
                  ? photoUrls[ex.wastage_photo_path]
                  : undefined;
                return (
                  <tr key={d.id} className="border-t border-[#e6e0d3]">
                    <td className="px-5 py-2.5 font-medium text-neutral-900">
                      {d.name}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={entry.prepared}
                        placeholder="0"
                        onChange={(e) => patch(d.id, { prepared: e.target.value })}
                        className={cellCls}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">
                      {fmtQty(sold)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={entry.staff}
                        placeholder="0"
                        onChange={(e) => patch(d.id, { staff: e.target.value })}
                        className={cellCls}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={entry.wasted}
                        placeholder="0"
                        onChange={(e) => patch(d.id, { wasted: e.target.value })}
                        className={cellCls}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <label
                        className="inline-flex cursor-pointer items-center rounded-lg border border-[#d9d1c1] bg-white px-2 py-1 text-sm transition hover:border-neutral-400"
                        title="Attach a waste photo"
                      >
                        📷
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) =>
                            setFiles((f) => ({
                              ...f,
                              [d.id]: e.target.files?.[0] ?? null,
                            }))
                          }
                        />
                      </label>
                      {file ? (
                        <span className="mt-0.5 block max-w-[96px] truncate text-[10px] text-neutral-500">
                          {file.name}
                        </span>
                      ) : ex?.wastage_photo_path ? (
                        photoUrl ? (
                          <a
                            href={photoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block text-[10px] text-indigo-700 underline transition hover:text-indigo-500"
                          >
                            photo ✓
                          </a>
                        ) : (
                          <span className="mt-0.5 block text-[10px] text-neutral-500">
                            photo ✓
                          </span>
                        )
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={entry.closing}
                        placeholder="—"
                        onChange={(e) => patch(d.id, { closing: e.target.value })}
                        className={cellCls}
                      />
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right font-semibold tabular-nums ${
                        variance < 0 ? "text-red-600" : "text-neutral-700"
                      }`}
                    >
                      {fmtQty(variance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-[#e6e0d3] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-neutral-500">
          Variance = prepared − sold − staff meals − wasted − closing. Untouched
          all-zero rows are skipped.
        </p>
        <div className="w-full sm:w-56">
          <SubmitButton pending={pending} pendingLabel={uploading ? "Uploading…" : "Saving…"}>
            Save dish worksheet
          </SubmitButton>
        </div>
      </div>
      {feedback && (
        <div className="px-5 pb-4">
          <FormFeedback feedback={feedback} />
        </div>
      )}
    </form>
  );
}
