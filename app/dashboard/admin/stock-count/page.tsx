import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SectionHeader from "../../_components/SectionHeader";
import StockCountSheet from "./StockCountSheet";
import type { LiveStockRow } from "../../store/types";

export const dynamic = "force-dynamic";

export default async function StockCountPage() {
  const supabase = await createClient();

  const [matRes, deptRes, stockRes] = await Promise.all([
    supabase
      .from("raw_materials")
      .select("id, name, stock_unit, category")
      .order("name"),
    supabase.from("departments").select("id, name").order("id"),
    supabase.from("live_stock").select("*").order("raw_material_name"),
  ]);

  const materials = (matRes.data ?? []) as {
    id: string;
    name: string;
    stock_unit: string;
    category: string | null;
  }[];
  const departments = (deptRes.data ?? []) as { id: number; name: string }[];
  const stock = (stockRes.data ?? []) as LiveStockRow[];

  const loadError = matRes.error || deptRes.error || stockRes.error;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">End-of-Day Stock Count</span>
      </div>

      <SectionHeader
        eyebrow="Administration"
        title="End-of-Day Reconciliation"
        description="Enter the physical closing stock per department. Variances against the system are posted as VARIANCE_RECONCILIATION transactions, resetting the ledger to match reality for the next day."
      />

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}.
        </p>
      )}

      {materials.length === 0 || departments.length === 0 ? (
        <p className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-12 text-center text-sm text-neutral-500">
          Add raw materials and departments first.
        </p>
      ) : (
        <StockCountSheet
          materials={materials}
          departments={departments}
          initialStock={stock}
        />
      )}
    </div>
  );
}
