"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CatalogState } from "./actions";

type Feedback = { type: "error" | "success"; text: string } | null;

export interface ImportPayload {
  headers: string[];
  rows: string[][];
  logDate: string;
}

interface Props {
  purpose: string;
  title: string;
  description: string;
  defaultTab: string;
  starterHeaders: string[];
  /** Whether the location's workspace sheet is configured (in Settings). */
  connected: boolean;
  /** The location workspace sheet URL (resolved server-side). */
  sheetUrl: string;
  importLabel?: string;
  importAction?: (payload: ImportPayload) => Promise<CatalogState>;
}

const today = () => new Date().toISOString().slice(0, 10);
const hasGrid = (headers: string[]) => headers.length > 0;

export default function SheetWorkspace({
  purpose,
  title,
  description,
  defaultTab,
  starterHeaders,
  connected,
  sheetUrl,
  importLabel,
  importAction,
}: Props) {
  const router = useRouter();
  const [pendingImport, startImport] = useTransition();

  const [tab, setTab] = useState(defaultTab);
  const [logDate, setLogDate] = useState(today);
  const [headers, setHeaders] = useState<string[]>(() => [...starterHeaders]);
  const [rows, setRows] = useState<string[][]>(() =>
    Array.from({ length: 3 }, () => starterHeaders.map(() => "")),
  );
  const [busy, setBusy] = useState<null | "push" | "pull">(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const dateColumn = useMemo(
    () => headers.findIndex((h) => h.trim().toLowerCase() === "date"),
    [headers],
  );

  const emptyRow = (len: number) => Array.from({ length: len }, () => "");

  function createWorkspace() {
    setHeaders([...starterHeaders]);
    setRows([emptyRow(starterHeaders.length), emptyRow(starterHeaders.length)]);
    setFeedback(null);
  }
  function addColumn() {
    setHeaders((h) => [...h, `Column ${h.length + 1}`]);
    setRows((rs) => rs.map((r) => [...r, ""]));
  }
  function removeColumn(c: number) {
    setHeaders((h) => h.filter((_, i) => i !== c));
    setRows((rs) => rs.map((r) => r.filter((_, i) => i !== c)));
  }
  function renameColumn(c: number, value: string) {
    setHeaders((h) => h.map((x, i) => (i === c ? value : x)));
  }
  function addRow() {
    const row = emptyRow(headers.length);
    if (dateColumn >= 0) row[dateColumn] = logDate;
    setRows((rs) => [...rs, row]);
  }
  function addDateColumn() {
    setHeaders((h) =>
      h.some((x) => x.trim().toLowerCase() === "date") ? h : [...h, "Date"],
    );
    setRows((rs) => rs.map((r) => [...r, logDate]));
  }
  function removeRow(r: number) {
    setRows((rs) => rs.filter((_, i) => i !== r));
  }
  function editCell(r: number, c: number, value: string) {
    setRows((rs) =>
      rs.map((row, i) => (i === r ? row.map((x, j) => (j === c ? value : x)) : row)),
    );
  }

  async function push() {
    setBusy("push");
    setFeedback(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "push", purpose, tab, headers, rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Push failed.");
      setFeedback({ type: "success", text: `Pushed ${data.rowCount} row(s) to "${tab}".` });
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setFeedback({ type: "error", text: e instanceof Error ? e.message : "Push failed." });
    } finally {
      setBusy(null);
    }
  }

  async function pull() {
    setBusy("pull");
    setFeedback(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pull", purpose, tab }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Pull failed.");
      const hdr: string[] = data.headers ?? [];
      const body: string[][] = (data.rows ?? []).map((r: string[]) => {
        const padded = [...r];
        while (padded.length < hdr.length) padded.push("");
        return padded;
      });
      setHeaders(hdr);
      setRows(body);
      setFeedback({ type: "success", text: `Pulled ${body.length} row(s) from "${tab}".` });
    } catch (e) {
      setFeedback({ type: "error", text: e instanceof Error ? e.message : "Pull failed." });
    } finally {
      setBusy(null);
    }
  }

  function saveToApp() {
    if (!importAction) return;
    setFeedback(null);
    startImport(async () => {
      const res = await importAction({ headers, rows, logDate });
      if (res.error) return setFeedback({ type: "error", text: res.error });
      setFeedback({ type: "success", text: res.success ?? "Saved." });
      router.refresh();
    });
  }

  const inputBase =
    "rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 [color-scheme:light]";
  const syncDisabled = !connected;

  return (
    <div className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
        </div>
        {connected ? (
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Connected
            </span>
            {sheetUrl && (
              <a
                href={sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-[#e6e0d3] px-2 py-1 transition hover:text-neutral-900"
              >
                Open
              </a>
            )}
          </div>
        ) : (
          <Link
            href="/dashboard/admin/settings"
            className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-700 transition hover:bg-amber-400/20"
          >
            Connect in Settings →
          </Link>
        )}
      </div>

      {!connected && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Connect your Google Sheet workspace in Settings to enable sync.
        </p>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Tab
          <input value={tab} onChange={(e) => setTab(e.target.value)} className={`${inputBase} w-32`} />
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Log date
          <input
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            className={`${inputBase} w-36`}
          />
        </label>
        <div className="flex-1" />
        <button type="button" onClick={createWorkspace} className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2 text-xs font-medium text-neutral-700 transition hover:bg-[#efe9dd] hover:text-neutral-900">
          Create Workspace
        </button>
        <button type="button" onClick={addDateColumn} className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2 text-xs font-medium text-neutral-700 transition hover:bg-[#efe9dd] hover:text-neutral-900">
          + Date col
        </button>
        <button type="button" onClick={addColumn} className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2 text-xs font-medium text-neutral-700 transition hover:bg-[#efe9dd] hover:text-neutral-900">
          + Column
        </button>
        <button type="button" onClick={addRow} className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2 text-xs font-medium text-neutral-700 transition hover:bg-[#efe9dd] hover:text-neutral-900">
          + Row
        </button>
        <button
          type="button"
          onClick={pull}
          disabled={busy !== null || syncDisabled}
          className="rounded-lg border border-[#d9d1c1] bg-[#f7f3ec] px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-[#efe9dd] disabled:opacity-50"
        >
          {busy === "pull" ? "Pulling…" : "Pull from Sheet"}
        </button>
        <button
          type="button"
          onClick={push}
          disabled={busy !== null || syncDisabled || !hasGrid(headers)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {busy === "push" ? "Pushing…" : "Push to Sheet"}
        </button>
        {importAction && (
          <button
            type="button"
            onClick={saveToApp}
            disabled={pendingImport || !hasGrid(headers)}
            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-400/20 disabled:opacity-60"
          >
            {pendingImport ? "Saving…" : `Save to ${importLabel ?? "App"}`}
          </button>
        )}
      </div>

      {hasGrid(headers) && (
        <div className="overflow-x-auto rounded-lg border border-[#e6e0d3]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-8 border-b border-[#e6e0d3] bg-[#f7f3ec]" />
                {headers.map((h, c) => (
                  <th key={c} className="border-b border-l border-[#e6e0d3] bg-[#f7f3ec] p-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        value={h}
                        onChange={(e) => renameColumn(c, e.target.value)}
                        placeholder={`Column ${c + 1}`}
                        className="w-full min-w-[8rem] rounded-md bg-transparent px-2 py-1 text-xs font-semibold text-neutral-900 outline-none focus:bg-[#efe9dd]"
                      />
                      <button type="button" onClick={() => removeColumn(c)} title="Remove column" className="shrink-0 rounded px-1 text-neutral-500 transition hover:text-red-600">
                        ×
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  <td className="border-b border-[#e6e0d3] text-center align-middle">
                    <button type="button" onClick={() => removeRow(r)} title="Remove row" className="px-1 text-neutral-700 transition hover:text-red-600">
                      ×
                    </button>
                  </td>
                  {row.map((cellValue, c) => (
                    <td key={c} className="border-b border-l border-[#e6e0d3] p-0">
                      <input
                        value={cellValue}
                        onChange={(e) => editCell(r, c, e.target.value)}
                        className="w-full min-w-[8rem] bg-transparent px-2.5 py-2 text-sm text-neutral-800 outline-none focus:bg-[#efe9dd]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {feedback && (
        <p
          role={feedback.type === "error" ? "alert" : "status"}
          className={`rounded-lg border px-3 py-2 text-sm ${
            feedback.type === "error"
              ? "border-red-200 bg-red-50 text-red-600"
              : "border-emerald-200 bg-emerald-50 text-emerald-600"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
