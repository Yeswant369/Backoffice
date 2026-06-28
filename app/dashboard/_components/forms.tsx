"use client";

import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded-lg border border-[#d9d1c1] bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-50 [color-scheme:light]";

export const labelCls =
  "mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-neutral-600";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <p className="mt-1 text-[11px] text-neutral-500">{hint}</p>}
    </div>
  );
}

export interface Feedback {
  type: "error" | "success";
  message: string;
}

export function FormFeedback({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  const isError = feedback.type === "error";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={`rounded-lg border px-3 py-2 text-sm ${
        isError
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-emerald-200 bg-emerald-50 text-emerald-600"
      }`}
    >
      {feedback.message}
    </p>
  );
}

export function SubmitButton({
  pending,
  children,
  pendingLabel = "Saving…",
}: {
  pending: boolean;
  children: ReactNode;
  pendingLabel?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
