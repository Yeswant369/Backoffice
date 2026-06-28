"use client";

import { useActionState } from "react";
import { setAreaManagerOutlets, type TeamState } from "./actions";

export default function AreaManagerOutlets({
  profileId,
  profileName,
  outlets,
  covered,
}: {
  profileId: string;
  profileName: string;
  outlets: { id: string; name: string }[];
  covered: string[];
}) {
  const [state, formAction, pending] = useActionState<
    TeamState | undefined,
    FormData
  >(setAreaManagerOutlets, undefined);
  const coveredSet = new Set(covered);

  return (
    <form
      action={formAction}
      className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5"
    >
      <input type="hidden" name="profile_id" value={profileId} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-900">{profileName}</p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save coverage"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {outlets.map((o) => (
          <label
            key={o.id}
            className="group flex cursor-pointer items-center gap-2 rounded-lg border border-[#e6e0d3] bg-[#faf7f1] px-3 py-1.5 text-sm text-neutral-700 transition hover:border-[#d9d1c1] hover:bg-[#efe9dd] has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-100 has-[:checked]:text-neutral-900"
          >
            <input
              type="checkbox"
              name="outlet_ids"
              value={o.id}
              defaultChecked={coveredSet.has(o.id)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            {o.name}
          </label>
        ))}
      </div>

      {state?.error && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p role="status" className="mt-3 text-xs text-emerald-600">
          {state.success}
        </p>
      )}
    </form>
  );
}
