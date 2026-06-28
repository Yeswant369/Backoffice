import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import SaleForm, { type RecipeLite } from "./SaleForm";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface SaleRow {
  id: string;
  quantity_sold: number;
  sale_date: string;
  recipes: { name: string; selling_price: number } | null;
}

export default async function SalesPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const [recipesRes, salesRes] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, selling_price")
      .eq("location_id", loc)
      .order("name"),
    supabase
      .from("manual_sales_log")
      .select("id, quantity_sold, sale_date, recipes ( name, selling_price )")
      .eq("location_id", loc)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const recipes = (recipesRes.data ?? []) as RecipeLite[];
  const sales = (salesRes.data ?? []) as unknown as SaleRow[];

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Record Sale</span>
      </div>

      <SectionHeader
        eyebrow="Operations"
        title="Record Sale"
        description="Log a non-POS sale. Each entry explodes the recipe and deducts ingredients from the Kitchen automatically, and mirrors to the Manual Sales sheet."
      />

      <div className="mt-8 mb-8">
        <SaleForm recipes={recipes} />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Recent sales</h2>
        </div>
        {sales.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No manual sales yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Dish</th>
                <th className="px-5 py-3 text-right font-medium">Qty</th>
                <th className="px-5 py-3 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-3.5 text-neutral-700">
                    {formatDate(s.sale_date)}
                  </td>
                  <td className="px-5 py-3.5 font-medium text-neutral-900">
                    {s.recipes?.name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                    {n(s.quantity_sold)}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                    {inr(n(s.quantity_sold) * n(s.recipes?.selling_price))}
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
