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
import { saveSubProductionSheet } from "./actions";

export interface SubLite {
  id: string;
  name: string;
}

export interface ExistingSubRow {
  opening_qty: number;
  made_qty: number;
  available_qty: number;
  used_qty: number;
  waste_qty: number;
  closing_qty: number | null;
  variance_qty: number | null;
  waste_photo_path: string | null;
}

interface Props {
  locationId: string;
  day: string;
  subs: SubLite[];
  existing: Record<string, ExistingSubRow>;
  /** Carry-forward opening for subs with no row on `day`. */
  openingMap: Record<string, number>;
  /** Auto-derived usage (parent dish sales + direct sales) for `day`. */
  usedMap: Record<string, number>;
  /** Signed URLs (path → url) for already-stored waste photos. */
  photoUrls: Record<string, string>;
}

interface Entry {
  made: string;
  waste: string;
  closing: string; // blank = not counted
}

const cellCls =
  "w-24 rounded-lg border border-[#d9d1c1] bg-white px-2.5 py-1.5 text-right text-sm tabular-nums text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 [color-scheme:light]";

const numStr = (v: number) => String(Number(v) || 0);
const fmtQty = (v: number) => String(Math.round(v * 1000) / 1000);

export default function SubRecipeWorksheet({
  locationId,
  day,
  subs,
  existing,
  openingMap,
  usedMap,
  photoUrls,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [state, formAction, actionPending] = useActionState(
    saveSubProductionSheet,
    undefined,
  );
  const [rows, setRows] = useState<Record<string, Entry>>(() => {
    const init: Record<string, Entry> = {};
    for (const s of subs) {
      const ex = existing[s.id];
      init[s.id] = ex
        ? {
            made: numStr(ex.made_qty),
            waste: numStr(ex.waste_qty),
            closing: ex.closing_qty === null ? "" : numStr(ex.closing_qty),
          }
        : { made: "", waste: "", closing: "" };
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
      made_qty: number;
      waste_qty: number;
      closing_qty: number | null;
      waste_photo_path: string | null;
    }[] = [];

    setUploading(true);
    try {
      for (const s of subs) {
        const entry = rows[s.id];
        const ex = existing[s.id];
        const file = files[s.id] ?? null;
        const made = Number(entry?.made) || 0;
        const waste = Number(entry?.waste) || 0;
        const closingBlank = (entry?.closing ?? "").trim() === "";
        const closing = closingBlank ? null : Number(entry?.closing) || 0;
        const touched = made !== 0 || waste !== 0 || closing !== null || !!file;
        // Skip untouched all-zero rows with no existing record.
        if (!touched && !ex) continue;

        let photoPath = ex?.waste_photo_path ?? null;
        if (file) photoPath = await uploadPhoto(file);

        payload.push({
          recipe_id: s.id,
          made_qty: made,
          waste_qty: waste,
          closing_qty: closing,
          waste_photo_path: photoPath,
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
    fd.set("rows", JSON.stringify(payload));
    startTransition(() => formAction(fd));
  }

  return (
    <form
      onSubmit={onSubmit}
      className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]"
    >
      <div className="border-b border-[#e6e0d3] px-5 py-4">
        <h2 className="text-sm font-semibold text-neutral-900">
          Sub-recipe worksheet
        </h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Opening carries forward from yesterday&apos;s closing; Used auto-derives
          from dish sales. Leave Closing blank if the batch wasn&apos;t counted.
        </p>
      </div>

      {subs.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-neutral-500">
          No sub-recipes for this department — mark recipes as ingredients of other
          dishes in Recipe Builder.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Sub-recipe</th>
                <th className="px-3 py-3 text-right font-medium">Opening</th>
                <th className="px-3 py-3 text-right font-medium">Made</th>
                <th className="px-3 py-3 text-right font-medium">Available</th>
                <th className="px-3 py-3 text-right font-medium">Used</th>
                <th className="px-3 py-3 text-right font-medium">Waste</th>
                <th className="px-3 py-3 text-right font-medium">📷</th>
                <th className="px-3 py-3 text-right font-medium">Closing</th>
                <th className="px-5 py-3 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => {
                const entry = rows[s.id] ?? { made: "", waste: "", closing: "" };
                const ex = existing[s.id];
                const file = files[s.id] ?? null;
                const opening = ex ? ex.opening_qty : (openingMap[s.id] ?? 0);
                const used = ex ? ex.used_qty : (usedMap[s.id] ?? 0);
                const available = opening + (Number(entry.made) || 0);
                const closingBlank = entry.closing.trim() === "";
                const variance = closingBlank
                  ? null
                  : available -
                    used -
                    (Number(entry.waste) || 0) -
                    (Number(entry.closing) || 0);
                const photoUrl = ex?.waste_photo_path
                  ? photoUrls[ex.waste_photo_path]
                  : undefined;
                return (
                  <tr key={s.id} className="border-t border-[#e6e0d3]">
                    <td className="px-5 py-2.5 font-medium text-neutral-900">
                      {s.name}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">
                      {fmtQty(opening)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={entry.made}
                        placeholder="0"
                        onChange={(e) => patch(s.id, { made: e.target.value })}
                        className={cellCls}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                      {fmtQty(available)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">
                      {fmtQty(used)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={entry.waste}
                        placeholder="0"
                        onChange={(e) => patch(s.id, { waste: e.target.value })}
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
                              [s.id]: e.target.files?.[0] ?? null,
                            }))
                          }
                        />
                      </label>
                      {file ? (
                        <span className="mt-0.5 block max-w-[96px] truncate text-[10px] text-neutral-500">
                          {file.name}
                        </span>
                      ) : ex?.waste_photo_path ? (
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
                        onChange={(e) => patch(s.id, { closing: e.target.value })}
                        className={cellCls}
                      />
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right font-semibold tabular-nums ${
                        variance !== null && variance < 0
                          ? "text-red-600"
                          : "text-neutral-700"
                      }`}
                    >
                      {variance === null ? "—" : fmtQty(variance)}
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
          Variance = available − used − waste − closing (only when closing is
          counted). Untouched all-zero rows are skipped.
        </p>
        <div className="w-full sm:w-56">
          <SubmitButton
            pending={pending}
            pendingLabel={uploading ? "Uploading…" : "Saving…"}
          >
            Save sub-recipe worksheet
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
