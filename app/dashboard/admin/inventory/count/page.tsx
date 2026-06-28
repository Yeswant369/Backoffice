import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles } from "@/lib/auth";
import { OPERATIONAL_ROLES } from "@/lib/roles";
import SectionHeader from "@/app/dashboard/_components/SectionHeader";
import StockCountForm from "./StockCountForm";

export const dynamic = "force-dynamic";

export default async function StockCountPage() {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !roles.some((r) => OPERATIONAL_ROLES.includes(r)))
    redirect("/dashboard");

  const supabase = await createClient();
  const [matRes, deptRes, stockRes] = await Promise.all([
    supabase
      .from("raw_materials")
      .select("id, name, category, stock_unit, par_level")
      .order("category")
      .order("name"),
    supabase.from("departments").select("id, name").order("id"),
    supabase
      .from("live_stock")
      .select("raw_material_id, department_id, current_stock"),
  ]);

  const departments = (deptRes.data ?? []) as { id: number; name: string }[];
  const storeDeptId =
    departments.find((d) => d.name.toLowerCase() === "store")?.id ??
    departments[0]?.id ??
    1;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Stock Count</span>
      </div>

      <SectionHeader
        eyebrow="Internal Routing"
        title="Stock Count"
        description="Count physical on-hand by department. Tap the steppers, or pull a count your manager filled in the Google Sheet on their iPad."
      />

      <StockCountForm
        materials={
          (matRes.data ?? []) as {
            id: string;
            name: string;
            category: string | null;
            stock_unit: string;
            par_level: number;
          }[]
        }
        departments={departments}
        storeDeptId={storeDeptId}
        stock={
          (stockRes.data ?? []) as {
            raw_material_id: string;
            department_id: number;
            current_stock: number;
          }[]
        }
      />
    </div>
  );
}
