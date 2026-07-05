import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import SectionHeader from "../../../_components/SectionHeader";
import IssueStockForm from "./IssueStockForm";
import IssueHistory, { type IssueEntry } from "./IssueHistory";

export const dynamic = "force-dynamic";

interface HistoryRow {
  id: string;
  created_at: string;
  transaction_date: string | null;
  quantity: number;
  raw_material_id: string | null;
  from_department_id: number | null;
  to_department_id: number | null;
  raw_materials: { name: string; stock_unit: string } | null;
}

export default async function IssueStockPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();

  // Pin everything to HOME — RLS read-scope spans the whole org for hybrid
  // Admin+Owner users, which would list other outlets' issues and let the
  // pickers choose a foreign-outlet department/material.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const [materialsRes, deptRes, stockRes, historyRes, wacRes] = await Promise.all([
    supabase
      .from("raw_materials")
      .select("id, name, code, stock_unit")
      .eq("location_id", loc)
      .order("name"),
    supabase
      .from("departments")
      .select("id, name")
      .eq("location_id", loc)
      .order("id"),
    supabase
      .from("live_stock")
      .select("raw_material_id, department_id, current_stock")
      .eq("location_id", loc),
    supabase
      .from("inventory_ledger")
      .select(
        "id, created_at, transaction_date, quantity, raw_material_id, from_department_id, to_department_id, raw_materials ( name, stock_unit )",
      )
      .in("type", ["INTER_DEPARTMENT_TRANSFER", "ISSUE_TO_KITCHEN"])
      .eq("location_id", loc)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("weighted_average_cost")
      .select("raw_material_id, weighted_avg_cost")
      .eq("location_id", loc),
  ]);

  const departments = (deptRes.data ?? []) as { id: number; name: string }[];
  const storeDeptId =
    departments.find((d) => d.name.toLowerCase() === "store")?.id ??
    departments[0]?.id ??
    1;
  const deptNames: Record<number, string> = {};
  for (const d of departments) deptNames[d.id] = d.name;

  // Business date normalised to an IST calendar day so the client-side range
  // filter agrees with the issue dates the form stamps (created_at is a
  // timestamptz).
  const istDay = (ts: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ts));

  const entries: IssueEntry[] = (
    (historyRes.data ?? []) as unknown as HistoryRow[]
  ).map((r) => ({
    id: r.id,
    date: r.transaction_date ?? istDay(r.created_at),
    materialId: r.raw_material_id,
    material: r.raw_materials?.name ?? "—",
    unit: r.raw_materials?.stock_unit ?? "",
    fromId: r.from_department_id,
    toId: r.to_department_id,
    qty: Number(r.quantity ?? 0),
  }));

  const wac: Record<string, number> = {};
  for (const w of wacRes.data ?? []) {
    wac[w.raw_material_id as string] = Number(w.weighted_avg_cost ?? 0);
  }

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
        description="Transfer materials between departments — one dated, multi-line issue per run. Each line posts an INTER_DEPARTMENT_TRANSFER to the ledger and mirrors to the Issues - [Department] sheet tab."
      />

      <IssueStockForm
        materials={
          (materialsRes.data ?? []) as {
            id: string;
            name: string;
            code: string | null;
            stock_unit: string;
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

      <div className="mt-8">
        <IssueHistory entries={entries} deptNames={deptNames} wac={wac} />
      </div>
    </div>
  );
}
