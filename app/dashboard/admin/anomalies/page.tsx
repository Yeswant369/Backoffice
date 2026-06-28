import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import SectionHeader from "../../_components/SectionHeader";

export const dynamic = "force-dynamic";

interface Anomaly {
  kind: string;
  severity: "high" | "medium";
  entity: string;
  detail: string;
  metric: number;
  occurred_on: string | null;
}

const KIND_LABEL: Record<string, string> = {
  NEGATIVE_STOCK: "Negative stock",
  STOCK_VARIANCE: "Stock variance",
  PRICE_SPIKE: "Price spike",
  UNMAPPED_SALE: "Unmapped POS",
  ITEM_WASTAGE: "Item wastage",
};

const SEV_RANK: Record<string, number> = { high: 0, medium: 1 };

export default async function AnomaliesPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const { data, error } = await supabase
    .from("anomalies")
    .select("kind, severity, entity, detail, metric, occurred_on")
    .eq("location_id", loc);
  const rows = ((data ?? []) as Anomaly[]).sort(
    (a, b) =>
      (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) ||
      (b.occurred_on ?? "").localeCompare(a.occurred_on ?? ""),
  );
  const highCount = rows.filter((r) => r.severity === "high").length;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Dashboards
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Anomalies</span>
      </div>

      <SectionHeader
        eyebrow="Dashboards"
        title="Anomalies"
        description="Automated flags from your live data — negative stock, large count variances, vendor price spikes, unmapped POS items and heavy item wastage. Nothing here is hand-entered."
      />

      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">Open flags </span>
          <span className="font-semibold text-neutral-900">{rows.length}</span>
        </div>
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">High severity </span>
          <span
            className={`font-semibold ${highCount > 0 ? "text-red-600" : "text-neutral-900"}`}
          >
            {highCount}
          </span>
        </div>
      </div>

      {error && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load anomalies: {error.message}. Confirm migration 0023
          has been applied.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No anomalies — everything looks healthy. ✅
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Severity</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium">Detail</th>
                <th className="px-5 py-3 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-3.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        r.severity === "high"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {r.severity}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-700">
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </td>
                  <td className="px-5 py-3.5 font-medium text-neutral-900">
                    {r.entity}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">{r.detail}</td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-500">
                    {r.occurred_on ?? "now"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
