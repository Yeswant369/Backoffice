import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import MetricCard from "../../_components/MetricCard";

export const dynamic = "force-dynamic";

interface RawMaterialRow {
  id: string;
  name: string;
  stock_unit: string;
  par_level: number;
  category: string | null;
  vendors: { name: string; vendor_code: string } | null;
}

const n = (v: unknown) => Number(v ?? 0);

export default async function PurchasingPage() {
  const supabase = await createClient();

  const [matRes, stockRes, wacRes] = await Promise.all([
    supabase
      .from("raw_materials")
      .select(
        "id, name, stock_unit, par_level, category, vendors ( name, vendor_code )",
      )
      .order("name"),
    supabase.from("live_stock").select("raw_material_id, current_stock"),
    supabase
      .from("weighted_average_cost")
      .select("raw_material_id, weighted_avg_cost"),
  ]);

  const materials = (matRes.data ?? []) as unknown as RawMaterialRow[];
  const loadError = matRes.error || stockRes.error || wacRes.error;

  // Total on-hand per material across all departments.
  const onHandByMaterial = new Map<string, number>();
  for (const row of stockRes.data ?? []) {
    onHandByMaterial.set(
      row.raw_material_id,
      (onHandByMaterial.get(row.raw_material_id) ?? 0) + n(row.current_stock),
    );
  }

  const wacByMaterial = new Map<string, number>();
  for (const row of wacRes.data ?? []) {
    wacByMaterial.set(row.raw_material_id, n(row.weighted_avg_cost));
  }

  // Suggested order = par_level − on_hand, where positive.
  const suggestions = materials
    .map((m) => {
      const onHand = onHandByMaterial.get(m.id) ?? 0;
      const suggested = Math.max(0, n(m.par_level) - onHand);
      const unitCost = wacByMaterial.get(m.id) ?? 0;
      return {
        ...m,
        onHand,
        suggested,
        unitCost,
        estCost: suggested * unitCost,
      };
    })
    .filter((s) => s.suggested > 0)
    .sort((a, b) => b.suggested - a.suggested);

  const totalEstCost = suggestions.reduce((s, r) => s + r.estCost, 0);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Auto-Procurement</span>
      </div>

      <SectionHeader
        eyebrow="Administration"
        title="Auto-Procurement"
        description="Materials below their par level, with suggested reorder quantities based on total on-hand stock across every department."
      />

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Items to reorder"
          value={String(suggestions.length)}
          sub="below par level"
          tone={suggestions.length > 0 ? "negative" : "positive"}
        />
        <MetricCard
          label="Est. procurement cost"
          value={inr(totalEstCost)}
          sub="at weighted-average cost"
        />
        <MetricCard
          label="Materials tracked"
          value={String(materials.length)}
        />
      </div>

      <div className="mt-8 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Suggested order</h2>
        </div>
        {suggestions.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-neutral-500">
            Everything is stocked at or above par. No orders suggested.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Material</th>
                <th className="px-5 py-3 font-medium">Vendor</th>
                <th className="px-5 py-3 text-right font-medium">On hand</th>
                <th className="px-5 py-3 text-right font-medium">Par</th>
                <th className="px-5 py-3 text-right font-medium">Order qty</th>
                <th className="px-5 py-3 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                >
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-neutral-900">{s.name}</div>
                    {s.category && (
                      <div className="text-[11px] text-neutral-500">
                        {s.category}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">
                    {s.vendors?.name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                    {s.onHand} {s.stock_unit}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                    {s.par_level} {s.stock_unit}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-neutral-900">
                    {s.suggested} {s.stock_unit}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                    {s.estCost > 0 ? inr(s.estCost) : "—"}
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
