"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveLocation } from "../actions";

interface Props {
  locations: { id: string; name: string }[];
  activeId: string | null;
}

/**
 * Outlet focus control for cross-outlet roles. Hidden for single-location
 * users. "All outlets" shows the org roll-up; picking one narrows every
 * read-only dashboard to that outlet.
 */
export default function LocationSwitcher({ locations, activeId }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (locations.length <= 1) return null;

  return (
    <div className="px-6 pb-2">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
        Viewing
      </label>
      <div className="relative">
        <select
          aria-label="Active outlet"
          value={activeId ?? "all"}
          disabled={pending}
          onChange={(e) => {
            const value = e.target.value;
            start(async () => {
              await setActiveLocation(value);
              router.refresh();
            });
          }}
          className="w-full appearance-none rounded-lg border border-[#d9d1c1] bg-[#efe9dd] px-3 py-2 pr-8 text-sm font-medium text-neutral-900 outline-none transition hover:bg-[#e6dccb] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-60"
        >
          <option value="all">All outlets</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}
