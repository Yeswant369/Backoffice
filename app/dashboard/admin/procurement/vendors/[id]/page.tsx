import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../../../../_components/SectionHeader";
import MetricCard from "../../../../_components/MetricCard";
import VendorHistoryTabs, {
  type PaymentEntry,
  type PurchaseEntry,
} from "./VendorHistoryTabs";
import VendorPaymentForm from "./VendorPaymentForm";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface PurchaseJoin {
  id: string;
  created_at: string;
  transaction_date: string | null;
  quantity: number;
  unit_price: number | null;
  raw_materials: { id: string; name: string; stock_unit: string } | null;
}

export default async function VendorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();

  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users,
  // so an unpinned lookup could load another outlet's vendor by pasted UUID.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";
  if (!loc) notFound();

  const [vendorRes, duesRes, purchaseRes, paymentRes] = await Promise.all([
    supabase
      .from("vendors")
      .select("id, vendor_code, name, status")
      .eq("id", id)
      .eq("location_id", loc)
      .maybeSingle(),
    supabase
      .from("vendor_dues")
      .select("total_purchased, total_paid, outstanding_due")
      .eq("vendor_id", id)
      .eq("location_id", loc)
      .maybeSingle(),
    supabase
      .from("inventory_ledger")
      .select(
        "id, created_at, transaction_date, quantity, unit_price, raw_materials ( id, name, stock_unit )",
      )
      .eq("vendor_id", id)
      .eq("location_id", loc)
      .eq("type", "PURCHASE")
      .order("created_at", { ascending: false }),
    supabase
      .from("vendor_payments")
      .select("id, payment_date, amount_paid, payment_mode, reference_utr")
      .eq("vendor_id", id)
      .eq("location_id", loc)
      .order("payment_date", { ascending: false }),
  ]);

  if (!vendorRes.data) notFound();
  const vendor = vendorRes.data;
  const dues = duesRes.data;

  // Business date normalised to an IST calendar day (created_at is timestamptz)
  // so the client range filter and the CSV export agree.
  const istDay = (ts: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ts));

  const purchases: PurchaseEntry[] = (
    (purchaseRes.data ?? []) as unknown as PurchaseJoin[]
  ).map((p) => ({
    id: p.id,
    date: p.transaction_date ?? istDay(p.created_at), // bill date, else IST entry day
    materialId: p.raw_materials?.id ?? null,
    material: p.raw_materials?.name ?? "—",
    unit: p.raw_materials?.stock_unit ?? "",
    qty: n(p.quantity),
    unitPrice: n(p.unit_price),
  }));

  // Last purchase by business date (rows are entry-ordered).
  const lastPurchase = purchases.reduce<PurchaseEntry | null>(
    (best, p) => (!best || p.date > best.date ? p : best),
    null,
  );

  const payments: PaymentEntry[] = (paymentRes.data ?? []).map((p) => ({
    id: p.id,
    date: p.payment_date,
    amount: n(p.amount_paid),
    mode: p.payment_mode,
    reference: p.reference_utr,
  }));

  const outstanding = n(dues?.outstanding_due);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link
          href="/dashboard/admin/procurement/vendors"
          className="transition hover:text-neutral-900"
        >
          Vendor Hub
        </Link>
        <span>/</span>
        <span className="text-neutral-700">{vendor.name}</span>
      </div>

      <SectionHeader
        eyebrow={vendor.vendor_code}
        title={vendor.name}
        description={`Status: ${vendor.status}`}
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total purchased" value={inr(n(dues?.total_purchased))} />
        <MetricCard label="Total paid" value={inr(n(dues?.total_paid))} tone="positive" />
        <MetricCard
          label="Outstanding due"
          value={inr(outstanding)}
          tone={outstanding > 0 ? "negative" : "default"}
        />
        <MetricCard
          label="Last purchase"
          value={lastPurchase ? formatDate(lastPurchase.date) : "—"}
          sub={
            lastPurchase
              ? `${lastPurchase.material} @ ${inr(lastPurchase.unitPrice)}`
              : "no purchases yet"
          }
        />
      </div>

      <VendorPaymentForm vendorId={vendor.id} />

      <VendorHistoryTabs purchases={purchases} payments={payments} vendorId={vendor.id} />
    </div>
  );
}
