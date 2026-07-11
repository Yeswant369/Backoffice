import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import SectionHeader from "../../../_components/SectionHeader";
import LiveStockMatrix, { type LiveStockRow } from "./LiveStockMatrix";

export const dynamic = "force-dynamic";

interface CategoryValueRow {
  category: string;
  material_type: string | null;
  materials: number;
  stock_value: number;
}

export default async function LiveStockPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();

  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const [{ data, error }, { data: materials }, { data: costs }, { data: catValues }] =
    await Promise.all([
      supabase
        .from("live_stock")
        .select(
          "raw_material_id, raw_material_name, category, stock_unit, par_level, department_id, department_name, current_stock",
        )
        .eq("location_id", loc)
        .order("raw_material_name"),
      supabase.from("raw_materials").select("id, code").eq("location_id", loc),
      supabase
        .from("weighted_average_cost")
        .select("raw_material_id, weighted_avg_cost")
        .eq("location_id", loc),
      supabase
        .from("stock_value_by_category")
        .select("category, material_type, materials, stock_value")
        .eq("location_id", loc)
        .order("stock_value", { ascending: false }),
    ]);

  const codeMap: Record<string, string> = {};
  for (const m of materials ?? []) {
    if (m.code) codeMap[m.id as string] = m.code as string;
  }
  const rateMap: Record<string, number> = {};
  for (const c of costs ?? []) {
    rateMap[c.raw_material_id as string] = Number(c.weighted_avg_cost ?? 0);
  }

  const categoryValues = (catValues ?? []) as CategoryValueRow[];
  const totalStockValue = categoryValues.reduce(
    (sum, r) => sum + Number(r.stock_value ?? 0),
    0,
  );

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Live Stock</span>
      </div>

      <SectionHeader
        eyebrow="Internal Routing"
        title="Master Hand Stock"
        description="Total on-hand stock per material across the location. Expand a row to see the departmental breakdown."
      />

      {error && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load stock: {error.message}.
        </p>
      )}

      {categoryValues.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
          <div className="border-b border-[#e6e0d3] px-5 py-3">
            <h3 className="text-sm font-semibold text-neutral-900">
              Stock value by category (latest purchase rate)
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              valued at each material&apos;s most recent purchase price
            </p>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-2.5 font-medium">Category</th>
                <th className="px-5 py-2.5 font-medium">Type</th>
                <th className="px-5 py-2.5 text-right font-medium">Materials</th>
                <th className="px-5 py-2.5 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {categoryValues.map((r) => (
                <tr
                  key={`${r.category}|${r.material_type ?? ""}`}
                  className="border-t border-[#e6e0d3]"
                >
                  <td className="px-5 py-2.5 font-medium text-neutral-900">
                    {r.category}
                  </td>
                  <td className="px-5 py-2.5 text-neutral-600">
                    {r.material_type ?? "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
                    {r.materials}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                    {inr(r.stock_value)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-[#e6e0d3] font-semibold text-neutral-900">
                <td className="px-5 py-2.5">Total</td>
                <td className="px-5 py-2.5" />
                <td className="px-5 py-2.5 text-right tabular-nums">
                  {categoryValues.reduce((s, r) => s + Number(r.materials ?? 0), 0)}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums">
                  {inr(totalStockValue)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <LiveStockMatrix
        rows={(data ?? []) as LiveStockRow[]}
        codeMap={codeMap}
        rateMap={rateMap}
      />
    </div>
  );
}
