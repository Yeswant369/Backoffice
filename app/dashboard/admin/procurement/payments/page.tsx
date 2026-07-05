import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import SectionHeader from "../../../_components/SectionHeader";
import PaymentsTable, { type PaymentRow } from "./PaymentsTable";

export const dynamic = "force-dynamic";

interface PaymentJoin {
  id: string;
  payment_date: string;
  amount_paid: number;
  payment_mode: string;
  reference_utr: string | null;
  vendor_id: string | null;
  vendors: { name: string; vendor_code: string } | null;
}

export default async function VendorPaymentsPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();

  // Pin to HOME — RLS read-scope spans the whole org for hybrid Admin+Owner
  // users, so an unpinned query would mix other outlets' payments into this
  // register (and their totals).
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const { data, count } = await supabase
    .from("vendor_payments")
    .select(
      "id, payment_date, amount_paid, payment_mode, reference_utr, vendor_id, vendors ( name, vendor_code )",
      { count: "exact" },
    )
    .eq("location_id", loc)
    .order("payment_date", { ascending: false })
    .limit(500);

  const rows: PaymentRow[] = ((data ?? []) as unknown as PaymentJoin[]).map(
    (p) => ({
      id: p.id,
      date: p.payment_date,
      amount: Number(p.amount_paid ?? 0),
      mode: p.payment_mode,
      reference: p.reference_utr,
      vendorId: p.vendor_id,
      vendor: p.vendors?.name ?? "—",
      code: p.vendors?.vendor_code ?? "—",
    }),
  );

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Vendor Payments</span>
      </div>

      <SectionHeader
        eyebrow="Procure-to-Pay"
        title="Vendor Payments"
        description="Every payment posted against a vendor, newest first. Filter by date, review mode-wise totals, and export the register as CSV."
      />

      <PaymentsTable rows={rows} totalCount={count ?? rows.length} />
    </div>
  );
}
