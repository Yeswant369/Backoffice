"use client";

import { useActionState } from "react";
import { resendInvite, type TenantState } from "./actions";

export default function ResendInviteButton({ email }: { email: string }) {
  const [state, action, pending] = useActionState<
    TenantState | undefined,
    FormData
  >(resendInvite, undefined);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-[#d9d1c1] bg-[#f7f3ec] px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-[#efe9dd] disabled:opacity-60"
      >
        {pending ? "Sending…" : "Resend invite"}
      </button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      {state?.success && <span className="text-xs text-emerald-600">Sent ✓</span>}
    </form>
  );
}
