"use client";

import { useState } from "react";

/** Read-only set-password link with Copy + WhatsApp share (no email needed). */
export default function InviteLinkBox({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const waText = encodeURIComponent(
    `You've been set up on BOH ERP. Tap to set your password and sign in:\n${link}`,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-md border border-[#d9d1c1] bg-white px-2 py-1 text-[11px] text-neutral-600"
      />
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="rounded-md border border-[#d9d1c1] bg-[#f7f3ec] px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-[#efe9dd]"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <a
        href={`https://wa.me/?text=${waText}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
      >
        WhatsApp
      </a>
    </div>
  );
}
