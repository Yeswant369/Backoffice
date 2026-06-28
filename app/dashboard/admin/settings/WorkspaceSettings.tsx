"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { connectWorkspaceSheet } from "./actions";

const ease = [0.22, 1, 0.36, 1] as const;

interface Props {
  connected: boolean;
  sheetUrl: string;
  botEmail: string;
}

export default function WorkspaceSettings({ connected, sheetUrl, botEmail }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setPending(true);
    const res = await connectWorkspaceSheet(undefined, new FormData(form));
    if (res.error) {
      setError(res.error);
      setPending(false);
      return;
    }
    setPending(false);
    setEditing(false);
    router.refresh();
  }

  const inputCls =
    "w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-4 py-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25";

  // --- Connected state ---
  if (connected && !editing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease }}
        className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-6"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 text-emerald-600"
              aria-hidden
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-neutral-900">
              Workspace Connected
            </h3>
            <p className="mt-1 text-sm text-neutral-600">
              Your Google Sheet is linked. Vendors, purchases, and stock issues
              mirror to it automatically.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
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
                Open Workspace
              </a>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-[#d9d1c1] px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-[#f7f3ec] hover:text-neutral-900"
              >
                Change Sheet
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // --- Unconnected / editing state ---
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-6"
    >
      <h3 className="text-base font-semibold text-neutral-900">
        Connect your workspace
      </h3>
      <ol className="mt-4 space-y-2 text-sm text-neutral-600">
        <li className="flex gap-2">
          <span className="text-neutral-500">1.</span> Create a blank Google
          Sheet.
        </li>
        <li className="flex gap-2">
          <span className="text-neutral-500">2.</span> Share it as an{" "}
          <span className="text-neutral-800">Editor</span> with our service
          account:
        </li>
      </ol>
      <div className="mt-2 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2 font-mono text-xs text-emerald-600">
        {botEmail || "service account email not configured"}
      </div>
      <p className="mt-3 text-sm text-neutral-600">
        3. Paste the sheet URL below and connect.
      </p>

      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <input
          name="sheet_url"
          required
          placeholder="https://docs.google.com/spreadsheets/d/…/edit"
          className={inputCls}
        />
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {pending ? "Connecting…" : "Connect Workspace"}
          </button>
          {connected && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="rounded-lg border border-[#d9d1c1] px-5 py-2.5 text-sm text-neutral-700 transition hover:bg-[#f7f3ec]"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </motion.div>
  );
}
