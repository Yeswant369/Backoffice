"use client";

import { useState, useTransition } from "react";
import { getInviteLink } from "./actions";
import { InviteLinkBox } from "./StaffForm";

/**
 * Mint a fresh set-password link for an invited staff member (links are
 * single-use and expire) — copy/WhatsApp it; no email delivery required.
 */
export default function GetLinkButton({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await getInviteLink(email);
            if (res.error) setError(res.error);
            setLink(res.link ?? null);
          })
        }
        className="rounded-lg border border-[#d9d1c1] bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-800 transition hover:bg-[#f3eee3] disabled:opacity-50"
      >
        {pending ? "…" : "Get link"}
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {link && <InviteLinkBox link={link} />}
    </div>
  );
}
