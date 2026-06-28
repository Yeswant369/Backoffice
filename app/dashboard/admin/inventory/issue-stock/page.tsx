import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import SectionHeader from "../../../_components/SectionHeader";
import IssueStockForm from "./IssueStockForm";

export const dynamic = "force-dynamic";

export default async function IssueStockPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();

  const [materialsRes, deptRes, stockRes] = await Promise.all([
    supabase.from("raw_materials").select("id, name, stock_unit").order("name"),
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
        <span className="text-neutral-700">Issue Stock</span>
      </div>

      <SectionHeader
        eyebrow="Internal Routing"
        title="Issue Stock"
        description="Transfer materials between departments. Posts an INTER_DEPARTMENT_TRANSFER to the ledger and mirrors to the Issues - [Department] sheet tab."
      />

      <IssueStockForm
        materials={(materialsRes.data ?? []) as { id: string; name: string; stock_unit: string }[]}
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
