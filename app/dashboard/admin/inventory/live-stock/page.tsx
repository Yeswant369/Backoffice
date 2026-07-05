import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import SectionHeader from "../../../_components/SectionHeader";
import LiveStockMatrix, { type LiveStockRow } from "./LiveStockMatrix";

export const dynamic = "force-dynamic";

export default async function LiveStockPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();

  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const [{ data, error }, { data: materials }, { data: costs }] = await Promise.all([
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
  ]);

  const codeMap: Record<string, string> = {};
  for (const m of materials ?? []) {
    if (m.code) codeMap[m.id as string] = m.code as string;
  }
  const rateMap: Record<string, number> = {};
  for (const c of costs ?? []) {
    rateMap[c.raw_material_id as string] = Number(c.weighted_avg_cost ?? 0);
  }

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

      <LiveStockMatrix
        rows={(data ?? []) as LiveStockRow[]}
        codeMap={codeMap}
        rateMap={rateMap}
      />
    </div>
  );
}
