"use client";

import { useActionState } from "react";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../_components/forms";
import { createDepartment, renameDepartment, type DeptState } from "./actions";

export interface DepartmentOption {
  id: number;
  name: string;
}

function RenameRow({ department }: { department: DepartmentOption }) {
  const [state, formAction, pending] = useActionState<
    DeptState | undefined,
    FormData
  >(renameDepartment, undefined);

  return (
    <li className="px-5 py-3">
      {/* key remount per success so the input re-reads the revalidated name. */}
      <form
        key={state?.token ?? "init"}
        action={formAction}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="department_id" value={department.id} />
        <div className="w-full max-w-xs">
          <input
            name="name"
            defaultValue={department.name}
            required
            maxLength={100}
            aria-label={`Rename ${department.name}`}
            className={inputCls}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
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
      </form>
    </li>
  );
}

export default function DepartmentManager({
  departments,
}: {
  departments: DepartmentOption[];
}) {
  const [state, formAction, pending] = useActionState<
    DeptState | undefined,
    FormData
  >(createDepartment, undefined);

  const feedback: Feedback | null = state?.error
    ? { type: "error", message: state.error }
    : state?.success
      ? { type: "success", message: state.success }
      : null;

  return (
    <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
      {/* key remount per success resets the form (no setState in effects). */}
      <form
        key={state?.token ?? "init"}
        action={formAction}
        className="space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
      >
        <h3 className="text-sm font-semibold text-neutral-900">
          Create department
        </h3>
        <Field label="Name">
          <input
            name="name"
            required
            maxLength={100}
            placeholder="e.g. Tandoor"
            className={inputCls}
          />
        </Field>
        <FormFeedback feedback={feedback} />
        <div className="sm:max-w-xs">
          <SubmitButton pending={pending} pendingLabel="Creating…">
            Create department
          </SubmitButton>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Departments{" "}
            <span className="ml-1 text-neutral-500">{departments.length}</span>
          </h3>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            Rename anytime. Deletes aren&apos;t offered — departments with
            ledger history stay for the audit trail.
          </p>
        </div>
        {departments.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No departments yet.
          </p>
        ) : (
          <ul className="divide-y divide-[#e6e0d3]">
            {departments.map((d) => (
              <RenameRow key={d.id} department={d} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
