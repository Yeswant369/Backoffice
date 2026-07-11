"use client";

import { useActionState, useState } from "react";
import { createDepartment, type DeptState } from "../departments/actions";

/**
 * Inline "+ New" on the department tabs row — create a custom department
 * without leaving Kitchen Production. Reuses the same server action as the
 * Department P&L manager (dupe + anchor guards live there).
 */
export default function NewDepartmentButton() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<
    DeptState | undefined,
    FormData
  >(createDepartment, undefined);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-white hover:shadow-sm"
        title="Create a new department"
      >
        + New
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pl-1">
      {/* key remount per success clears the input (no setState in effects). */}
      <form
        key={state?.token ?? "init"}
        action={formAction}
        className="flex items-center gap-2"
      >
        <input
          name="name"
          required
          maxLength={100}
          placeholder="e.g. Chinese"
          aria-label="New department name"
          className="w-40 rounded-md border border-[#d9d1c1] bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1.5 text-sm text-neutral-500 transition hover:text-neutral-800"
        >
          Cancel
        </button>
      </form>
      {state?.error && (
        <span role="alert" className="text-[11px] text-red-600">
          {state.error}
        </span>
      )}
      {state?.success && (
        <span role="status" className="text-[11px] text-emerald-600">
          {state.success}
        </span>
      )}
    </div>
  );
}
