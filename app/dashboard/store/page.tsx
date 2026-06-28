import { createClient } from "@/lib/supabase/server";
import SectionHeader from "../_components/SectionHeader";
import StoreDashboard from "./StoreDashboard";
import type {
  DepartmentOption,
  LiveStockRow,
  RawMaterialOption,
  VendorOption,
} from "./types";

export const dynamic = "force-dynamic";

export default async function StorePage() {
  const supabase = await createClient();

  const [stockRes, vendorsRes, materialsRes, deptRes] = await Promise.all([
    supabase.from("live_stock").select("*").order("raw_material_name"),
    supabase
      .from("vendors")
      .select("id, vendor_code, name")
      .order("name"),
    supabase
      .from("raw_materials")
      .select(
        "id, name, brand, purchase_unit, stock_unit, conversion_factor, vendor_id, category",
      )
      .order("name"),
    supabase.from("departments").select("id, name").order("id"),
  ]);

  const stock = (stockRes.data ?? []) as LiveStockRow[];
  const vendors = (vendorsRes.data ?? []) as VendorOption[];
  const materials = (materialsRes.data ?? []) as RawMaterialOption[];
  const departments = (deptRes.data ?? []) as DepartmentOption[];

  // Resolve the Store department (fall back to id 1 from the Phase 1 seed).
  const storeDeptId =
    departments.find((d) => d.name.toLowerCase() === "store")?.id ??
    departments[0]?.id ??
    1;

  const loadError =
    stockRes.error || vendorsRes.error || materialsRes.error || deptRes.error;

  return (
    <div>
      <SectionHeader
        eyebrow="Store & Inventory"
        title="Stock Control"
        description="Record purchases, issue stock to departments, log vendor payments, and watch live stock update in real time."
      />

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}. Confirm the Phase 1
          migration (tables, views &amp; grants) has been applied.
        </p>
      )}

      <StoreDashboard
        initialStock={stock}
        vendors={vendors}
        materials={materials}
        departments={departments}
        storeDeptId={storeDeptId}
      />
    </div>
  );
}
