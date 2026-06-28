"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import type { CatalogState } from "./actions";

interface Props {
  id: string;
  action: (id: string) => Promise<CatalogState>;
  confirmMessage?: string;
  /** After a successful delete, mirror the change to the Google Sheet. */
  syncOnSuccess?: boolean;
}

export default function DeleteButton({
  id,
  action,
  confirmMessage,
  syncOnSuccess,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span className="text-[11px] text-red-600">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirmMessage && !window.confirm(confirmMessage)) return;
          setError(null);
          startTransition(async () => {
            const res = await action(id);
            if (res?.error) {
              setError(res.error);
              return;
            }
            // Reflect the removal in the sheet immediately (e.g. Recipes tab).
            if (syncOnSuccess) {
              await triggerSheetSync();
              router.refresh();
            }
          });
        }}
        className="rounded-lg border border-[#e6e0d3] px-2.5 py-1 text-xs text-neutral-600 transition hover:border-red-500/30 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        {pending ? "…" : "Delete"}
      </button>
    </div>
  );
}
