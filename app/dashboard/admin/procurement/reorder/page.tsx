import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import SectionHeader from "../../../_components/SectionHeader";

export const dynamic = "force-dynamic";

interface Suggestion {
  raw_material_id: string;
  raw_material_name: string;
  stock_unit: string;
  par_level: number;
  current_stock: number;
  suggested_qty: number;
  last_unit_cost: number;
  est_cost: number;
  vendor_id: string | null;
  vendor_name: string | null;
  days_cover: number | null;
}

const n = (v: unknown) => Number(v ?? 0);

export default async function ReorderPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("reorder_suggestions")
    .select("*")
    .order("days_cover", { ascending: true, nullsFirst: true });
  const rows = (data ?? []) as Suggestion[];
  const totalEst = rows.reduce((s, r) => s + n(r.est_cost), 0);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Reorder</span>
      </div>

      <SectionHeader
        eyebrow="Procure-to-Pay"
        title="Reorder Suggestions"
        description="Items below PAR, ranked by days of cover left (from recent sales velocity). One click pre-fills a purchase at the usual vendor and last price."
      />

      {error && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load suggestions: {error.message}. Confirm migration 0018
          (reorder_suggestions view) has been applied.
        </p>
      )}

      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">Items below PAR </span>
          <span className="font-semibold text-neutral-900">{rows.length}</span>
        </div>
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">Est. replenishment spend </span>
          <span className="font-semibold text-neutral-900">{inr(totalEst)}</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            Everything is at or above PAR. Nothing to reorder.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Material</th>
                <th className="px-5 py-3 text-right font-medium">Days cover</th>
                <th className="px-5 py-3 text-right font-medium">On hand / PAR</th>
                <th className="px-5 py-3 text-right font-medium">Suggested</th>
                <th className="px-5 py-3 text-right font-medium">Est. cost</th>
                <th className="px-5 py-3 font-medium">Vendor</th>
                <th className="px-5 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cover = r.days_cover;
                const urgent = cover != null && cover <= 3;
                const href =
                  `/dashboard/admin/procurement/purchase-log?material=${r.raw_material_id}` +
                  `&vendor=${r.vendor_id ?? ""}&qty=${n(r.suggested_qty)}&rate=${n(r.last_unit_cost)}`;
                return (
                  <tr
                    key={r.raw_material_id}
                    className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                  >
                    <td className="px-5 py-3.5 font-medium">
                      <Link
                        href={`/dashboard/admin/materials/${r.raw_material_id}`}
                        className="text-indigo-700 transition hover:text-indigo-500"
                      >
                        {r.raw_material_name}
                      </Link>
                    </td>
                    <td
                      className={`px-5 py-3.5 text-right font-semibold tabular-nums ${
                        cover == null
                          ? "text-neutral-400"
                          : urgent
                            ? "text-red-600"
                            : "text-neutral-700"
                      }`}
                    >
                      {cover == null ? "—" : `${cover}d`}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                      {n(r.current_stock)} / {n(r.par_level)} {r.stock_unit}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-neutral-900">
                      {n(r.suggested_qty)} {r.stock_unit}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                      {inr(r.est_cost)}
                    </td>
                    <td className="px-5 py-3.5 text-neutral-700">
                      {r.vendor_name ?? (
                        <span className="text-neutral-400">No vendor set</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={href}
                        className="inline-block rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500"
                      >
                        Pre-fill purchase →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
