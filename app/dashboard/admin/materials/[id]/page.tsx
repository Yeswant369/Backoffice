import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../../../_components/SectionHeader";
import MetricCard from "../../../_components/MetricCard";
import MaterialHistory, { type MaterialPurchaseEntry } from "./MaterialHistory";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface LedgerJoin {
  id: string;
  created_at: string;
  transaction_date: string | null;
  quantity: number;
  unit_price: number | null;
  vendors: { id: string; name: string } | null;
}

/** Raw-material profile: identity + live cost/stock metrics + per-vendor purchase history. */
export default async function MaterialProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();

  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";
  if (!loc) notFound();

  const [matRes, wacRes, stockRes, purchaseRes] = await Promise.all([
    supabase
      .from("raw_materials")
      .select(
        "id, name, code, brand, category, purchase_unit, stock_unit, conversion_factor, par_level, needs_review",
      )
      .eq("id", id)
      .eq("location_id", loc)
      .maybeSingle(),
    supabase
      .from("weighted_average_cost")
      .select("weighted_avg_cost")
      .eq("raw_material_id", id)
      .eq("location_id", loc)
      .maybeSingle(),
    supabase
      .from("live_stock")
      .select("department_name, current_stock")
      .eq("raw_material_id", id)
      .eq("location_id", loc),
    supabase
      .from("inventory_ledger")
      .select(
        "id, created_at, transaction_date, quantity, unit_price, vendors ( id, name )",
        { count: "exact" },
      )
      .eq("raw_material_id", id)
      .eq("location_id", loc)
      .eq("type", "PURCHASE")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (!matRes.data) notFound();
  const mat = matRes.data;

  // Business date normalised to an IST calendar day so the client-side range
  // filter and the CSV export agree (created_at is a timestamptz).
  const istDay = (ts: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ts));

  const purchases: MaterialPurchaseEntry[] = (
    (purchaseRes.data ?? []) as unknown as LedgerJoin[]
  ).map((p) => ({
    id: p.id,
    date: p.transaction_date ?? istDay(p.created_at), // bill date, else IST entry day
    vendorId: p.vendors?.id ?? null,
    vendor: p.vendors?.name ?? "Unknown vendor",
    qty: n(p.quantity),
    unitPrice: n(p.unit_price),
  }));
  const purchaseCount = purchaseRes.count ?? purchases.length;

  // Last purchase by business date (list is entry-ordered; bill dates can differ).
  const last = purchases.reduce<MaterialPurchaseEntry | null>(
    (best, p) => (!best || p.date > best.date ? p : best),
    null,
  );
  const onHand = (stockRes.data ?? []).reduce((s, r) => s + n(r.current_stock), 0);
  const wac = n(wacRes.data?.weighted_avg_cost);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin/catalog" className="transition hover:text-neutral-900">
          Catalog
        </Link>
        <span>/</span>
        <span className="text-neutral-700">{mat.name}</span>
      </div>

      <SectionHeader
        eyebrow={mat.code ?? "Raw material"}
        title={mat.name}
        description={[
          mat.brand && `Brand: ${mat.brand}`,
          mat.category && `Category: ${mat.category}`,
          `Bought in ${mat.purchase_unit}, stocked in ${mat.stock_unit}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Current avg cost"
          value={wac > 0 ? `${inr(wac)}/${mat.stock_unit}` : "—"}
        />
        <MetricCard
          label="Last purchase"
          value={last ? inr(last.unitPrice) : "—"}
          sub={last ? `${formatDate(last.date)} · ${last.vendor}` : "no purchases yet"}
        />
        <MetricCard
          label="On hand (all depts)"
          value={`${onHand.toLocaleString()} ${mat.stock_unit}`}
          tone={onHand < n(mat.par_level) ? "negative" : "default"}
        />
        <MetricCard label="PAR level" value={`${n(mat.par_level)} ${mat.stock_unit}`} />
      </div>

      {(stockRes.data ?? []).length > 0 && (
        <div className="mb-8 flex flex-wrap gap-3 text-sm">
          {(stockRes.data ?? []).map((s) => (
            <span
              key={s.department_name}
              className="rounded-full border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-1 text-neutral-700"
            >
              {s.department_name}:{" "}
              <span className="font-semibold tabular-nums">
                {n(s.current_stock).toLocaleString()} {mat.stock_unit}
              </span>
            </span>
          ))}
        </div>
      )}

      {purchaseCount > purchases.length && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          Showing the newest {purchases.length} of {purchaseCount} purchases —
          range totals below cover only these rows.
        </p>
      )}
      <MaterialHistory purchases={purchases} stockUnit={mat.stock_unit} />
    </div>
  );
}
