"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import DateRangePresets from "./DateRangePresets";

/**
 * URL-synced variant of the date filter for SERVER pages: reflects the current
 * `?from=&to=` params and writes the chosen range back to the URL, so the page
 * re-renders server-side with the new range (shareable / bookmarkable). Server
 * pages parse the params with resolveDateRange().
 */
export default function DateRangeUrlControl({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <DateRangePresets
      value={{ from, to }}
      onChange={(range) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("from", range.from);
        params.set("to", range.to);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
    />
  );
}
