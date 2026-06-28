"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Busy = null | "push" | "pull";
type Msg = { type: "error" | "success"; text: string } | null;

function Spinner() {
  return (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />
  );
}

export default function SyncBar({ sheetUrl }: { sheetUrl: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [autoCreate, setAutoCreate] = useState(false);

  function goToWorkspace() {
    if (sheetUrl) window.open(sheetUrl, "_blank", "noopener,noreferrer");
  }

  async function push() {
    setBusy("push");
    setMsg(null);
    try {
      const res = await fetch("/api/sheets/push", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Push failed.");
      setMsg({
        type: "success",
        text: `Pushed ${data.recipeCount} recipe${data.recipeCount === 1 ? "" : "s"} to ${data.tabs?.length ?? 0} tab${data.tabs?.length === 1 ? "" : "s"}. Opening sheet…`,
      });
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Push failed." });
    } finally {
      setBusy(null);
    }
  }

  async function pull() {
    setBusy("pull");
    setMsg(null);
    try {
      const res = await fetch("/api/sheets/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCreate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Pull failed.");
      const parts = [`${data.dishes} dish${data.dishes === 1 ? "" : "es"} synced`];
      if (data.createdRecipes) parts.push(`${data.createdRecipes} recipe(s) created`);
      parts.push(
        `${data.updatedIngredients} ingredient line${data.updatedIngredients === 1 ? "" : "s"}`,
      );
      if (data.createdMaterials)
        parts.push(`${data.createdMaterials} material(s) auto-created`);
      if (data.unmatchedMaterials?.length)
        parts.push(`${data.unmatchedMaterials.length} unmatched material(s)`);
      if (data.skippedTabs?.length)
        parts.push(`skipped ${data.skippedTabs.length} non-recipe tab(s)`);
      setMsg({ type: "success", text: parts.join(" · ") });
      router.refresh();
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Pull failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Google Sheets sync
          </h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            “Thrayam Recipes &amp; Costing” — push live DB costings or pull
            quantities back.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="mr-1 flex cursor-pointer items-center gap-2 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2.5 text-sm text-neutral-700 transition hover:bg-[#efe9dd]">
            <input
              type="checkbox"
              checked={autoCreate}
              onChange={(e) => setAutoCreate(e.target.checked)}
              className="h-3.5 w-3.5 accent-amber-400"
            />
            Auto-create missing materials
          </label>
          {sheetUrl && (
            <button
              type="button"
              onClick={goToWorkspace}
              className="flex items-center gap-2 rounded-lg border border-[#d9d1c1] bg-[#f7f3ec] px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-[#efe9dd]"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden
              >
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
              Go to Workspace
            </button>
          )}
          <button
            type="button"
            onClick={pull}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg border border-[#d9d1c1] bg-[#f7f3ec] px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-[#efe9dd] disabled:opacity-50"
          >
            {busy === "pull" ? <Spinner /> : null}
            Pull from Sheet
          </button>
          <button
            type="button"
            onClick={push}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy === "push" ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : null}
            Push to Sheet
          </button>
        </div>
      </div>

      {msg && (
        <p
          role={msg.type === "error" ? "alert" : "status"}
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            msg.type === "error"
              ? "border-red-200 bg-red-50 text-red-600"
              : "border-emerald-200 bg-emerald-50 text-emerald-600"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
