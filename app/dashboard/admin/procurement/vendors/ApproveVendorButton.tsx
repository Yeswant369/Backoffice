"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveVendor } from "../actions";

export default function ApproveVendorButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await approveVendor(id);
          router.refresh();
        })
      }
      className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
    >
      {pending ? "…" : "Approve"}
    </button>
  );
}
