/**
 * Instant navigation feedback for the whole /dashboard tree. Next.js shows this
 * skeleton immediately on every click (Suspense boundary) while the dynamic page
 * renders on the server — so navigation feels instant even when data is loading.
 * Purely presentational; no data or auth logic.
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="mb-6 h-4 w-44 rounded bg-neutral-200" />
      <div className="mb-2 h-7 w-72 rounded bg-neutral-200" />
      <div className="mb-8 h-4 w-96 max-w-full rounded bg-neutral-100" />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]"
          />
        ))}
      </div>

      <div className="space-y-3 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5">
        <div className="h-5 w-40 rounded bg-neutral-200" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 rounded bg-neutral-100" />
        ))}
      </div>
    </div>
  );
}
