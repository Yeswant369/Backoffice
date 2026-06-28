import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import ProductionForm, {
  type RecipeLite,
  type DeptLite,
} from "./ProductionForm";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface ProdRow {
  id: string;
  production_date: string;
  department_name: string | null;
  recipe_name: string;
  prepared_qty: number;
  sold_qty: number;
  wastage_qty: number;
  variance: number;
  wastage_cost: number;
}

export default async function KitchenProductionPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const [recipesRes, deptsRes, prodRes] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, department_id")
      .eq("location_id", loc)
      .order("name"),
    supabase
      .from("departments")
      .select("id, name")
      .eq("location_id", loc)
      .order("name"),
    supabase
      .from("kitchen_production_view")
      .select(
        "id, production_date, department_name, recipe_name, prepared_qty, sold_qty, wastage_qty, variance, wastage_cost",
      )
      .eq("location_id", loc)
      .order("production_date", { ascending: false })
      .limit(20),
  ]);

  const recipes = (recipesRes.data ?? []) as RecipeLite[];
  const departments = (deptsRes.data ?? []) as DeptLite[];
  const rows = (prodRes.data ?? []) as ProdRow[];

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Kitchen Production</span>
      </div>

      <SectionHeader
        eyebrow="Kitchen Management"
        title="Kitchen Production"
        description="Log prepared vs sold vs wasted per dish, per department. Variance and item-wastage cost are computed automatically and mirror to the sheet."
      />

      <div className="mt-8 mb-8">
        <ProductionForm recipes={recipes} departments={departments} />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Recent production</h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No production recorded yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Dept</th>
                <th className="px-5 py-3 font-medium">Dish</th>
                <th className="px-5 py-3 text-right font-medium">Prepared</th>
                <th className="px-5 py-3 text-right font-medium">Sold</th>
                <th className="px-5 py-3 text-right font-medium">Wasted</th>
                <th className="px-5 py-3 text-right font-medium">Variance</th>
                <th className="px-5 py-3 text-right font-medium">Waste ₹</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = n(r.variance);
                return (
                  <tr key={r.id} className="border-t border-[#e6e0d3]">
                    <td className="px-5 py-3.5 text-neutral-700">
                      {formatDate(r.production_date)}
                    </td>
                    <td className="px-5 py-3.5 text-neutral-600">
                      {r.department_name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 font-medium text-neutral-900">
                      {r.recipe_name}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                      {n(r.prepared_qty)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                      {n(r.sold_qty)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                      {n(r.wastage_qty)}
                    </td>
                    <td
                      className={`px-5 py-3.5 text-right font-semibold tabular-nums ${
                        Math.abs(v) > 0.001 ? "text-amber-700" : "text-emerald-600"
                      }`}
                    >
                      {v}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                      {inr(r.wastage_cost)}
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
