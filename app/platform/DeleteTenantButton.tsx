"use client";

import { useActionState } from "react";
import { deleteTenant, type TenantState } from "./actions";

export default function DeleteTenantButton({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const [state, action, pending] = useActionState<
    TenantState | undefined,
    FormData
  >(deleteTenant, undefined);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete "${orgName}" and ALL its outlets, staff and data? This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="org_id" value={orgId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state?.error && (
        <span className="max-w-[16rem] text-right text-[11px] text-red-600">
          {state.error}
        </span>
      )}
    </form>
  );
}
