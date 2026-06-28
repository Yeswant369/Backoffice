import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../../../_components/SectionHeader";
import PurchaseForm from "./PurchaseForm";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface PurchaseRow {
  id: string;
  created_at: string;
  quantity: number;
  unit_price: number | null;
  raw_materials: { name: string; stock_unit: string } | null;
  vendors: { name: string } | null;
}

export default async function PurchaseLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  // Deep-link pre-fill from the Reorder engine (?material=&vendor=&qty=&rate=).
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) || undefined;
  const initial = {
    vendorId: one(sp.vendor),
    materialId: one(sp.material),
    qty: one(sp.qty),
    price: one(sp.rate),
  };

  const supabase = await createClient();

  // Pin everything to HOME — RLS read-scope spans the whole org for hybrid
  // Admin+Owner users, which would (a) list other outlets' purchases and (b) let
  // the dropdowns pick a foreign-outlet vendor/material, creating a cross-location
  // ledger row that renders as "—".
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const [vendorsRes, materialsRes, purchasesRes] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, name, vendor_code")
      .eq("location_id", loc)
      .eq("approved", true)
      .order("name"),
    supabase
      .from("raw_materials")
      .select("id, name, stock_unit")
      .eq("location_id", loc)
      .order("name"),
    supabase
      .from("inventory_ledger")
      .select(
        "id, created_at, quantity, unit_price, raw_materials ( name, stock_unit ), vendors ( name )",
      )
      .eq("type", "PURCHASE")
      .eq("location_id", loc)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const purchases = (purchasesRes.data ?? []) as unknown as PurchaseRow[];

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Purchase Log</span>
      </div>

      <SectionHeader
        eyebrow="Procure-to-Pay"
        title="Purchase Log"
        description="Record vendor purchases. Each entry posts a PURCHASE row to the immutable ledger and mirrors to the Purchase Log sheet."
      />

      <PurchaseForm
        vendors={(vendorsRes.data ?? []) as { id: string; name: string; vendor_code?: string }[]}
        materials={(materialsRes.data ?? []) as { id: string; name: string; stock_unit?: string }[]}
        initial={initial}
      />

      <div className="mt-8 overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">Recent purchases</h3>
        </div>
        {purchases.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No purchases yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 font-medium">Vendor</th>
                <th className="px-5 py-2.5 font-medium">Material</th>
                <th className="px-5 py-2.5 text-right font-medium">Qty</th>
                <th className="px-5 py-2.5 text-right font-medium">Unit price</th>
                <th className="px-5 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-2.5 text-neutral-700">
                    {formatDate(p.created_at)}
                  </td>
                  <td className="px-5 py-2.5 text-neutral-700">
                    {p.vendors?.name ?? "—"}
                  </td>
                  <td className="px-5 py-2.5 text-neutral-700">
                    {p.raw_materials?.name ?? "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
                    {n(p.quantity)} {p.raw_materials?.stock_unit ?? ""}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
                    {inr(p.unit_price)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                    {inr(n(p.quantity) * n(p.unit_price))}
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
