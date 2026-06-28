"use client";

import { useActionState } from "react";
import { generateInviteLink, type LinkState } from "./actions";
import InviteLinkBox from "./InviteLinkBox";

export default function InviteLinkButton({ email }: { email: string }) {
  const [state, action, pending] = useActionState<
    LinkState | undefined,
    FormData
  >(generateInviteLink, undefined);

  return (
    <div className="space-y-1.5">
      <form action={action}>
        <input type="hidden" name="email" value={email} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-[#d9d1c1] bg-[#f7f3ec] px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-[#efe9dd] disabled:opacity-60"
        >
          {pending ? "Generating…" : "Get link"}
        </button>
      </form>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.link && <InviteLinkBox link={state.link} />}
    </div>
  );
}
