import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { toCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const day = (v: unknown) => String(v ?? "").slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);

const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s: string | null) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

interface NameRef {
  name: string | null;
  vendor_code?: string | null;
}

/**
 * Export Purchases (as bills) or Payments as CSV for Tally / Zoho Books import.
 * Admin-only, pinned to the caller's home location. ?type=purchases|payments,
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: last 90 days → today, IST).
 */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "payments" ? "payments" : "purchases";
  // Optional per-vendor filter (used by the vendor-profile report download).
  const vendorId = isUuid(url.searchParams.get("vendor"))
    ? url.searchParams.get("vendor")
    : null;
  const todayIST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const ninetyAgo = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })
    .format(new Date(Date.now() - 90 * 86400000));
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : ninetyAgo;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : todayIST;
  // Exclusive next-day (IST) bound for created_at fallback comparisons.
  const toNextDate = new Date(`${to}T00:00:00+05:30`);
  toNextDate.setDate(toNextDate.getDate() + 1);
  const toNext = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(toNextDate);

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";
  if (!loc) {
    return NextResponse.json(
      { error: "Your account isn't assigned to a location." },
      { status: 400 },
    );
  }

  let rows: (string | number)[][];
  let filename: string;

  if (type === "payments") {
    let q = supabase
      .from("vendor_payments")
      .select("payment_date, amount_paid, payment_mode, reference_utr, vendors ( name, vendor_code )")
      .eq("location_id", loc)
      .gte("payment_date", from)
      .lte("payment_date", to)
      .order("payment_date");
    if (vendorId) q = q.eq("vendor_id", vendorId);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows = [
      ["Date", "Vendor", "Vendor Code", "Amount", "Mode", "Reference"],
      ...((data ?? []) as unknown as Array<{
        payment_date: string;
        amount_paid: number;
        payment_mode: string;
        reference_utr: string | null;
        vendors: NameRef | null;
      }>).map((p) => [
        day(p.payment_date),
        p.vendors?.name ?? "",
        p.vendors?.vendor_code ?? "",
        num(p.amount_paid).toFixed(2),
        p.payment_mode ?? "",
        p.reference_utr ?? "",
      ]),
    ];
    filename = `${vendorId ? "vendor_" : ""}payments_${from}_to_${to}.csv`;
  } else {
    let q = supabase
      .from("inventory_ledger")
      .select(
        "created_at, transaction_date, quantity, unit_price, raw_materials ( name ), vendors ( name, vendor_code ), purchase_bills ( invoice_no )",
      )
      .eq("type", "PURCHASE")
      .eq("location_id", loc)
      // Window on the BILL date (transaction_date), shown in the export; fall
      // back to created_at only when no invoice date was recorded.
      .or(
        `and(transaction_date.gte.${from},transaction_date.lte.${to}),` +
          `and(transaction_date.is.null,created_at.gte.${from}T00:00:00+05:30,created_at.lt.${toNext}T00:00:00+05:30)`,
      )
      .order("created_at");
    if (vendorId) q = q.eq("vendor_id", vendorId);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows = [
      ["Bill Date", "Bill No", "Vendor", "Vendor Code", "Item", "Qty", "Unit Price", "Amount"],
      ...((data ?? []) as unknown as Array<{
        created_at: string;
        transaction_date: string | null;
        quantity: number;
        unit_price: number | null;
        raw_materials: NameRef | null;
        vendors: NameRef | null;
        purchase_bills: { invoice_no: string | null } | null;
      }>).map((p) => {
        const amt = num(p.quantity) * num(p.unit_price);
        return [
          day(p.transaction_date ?? p.created_at),
          p.purchase_bills?.invoice_no ?? "",
          p.vendors?.name ?? "",
          p.vendors?.vendor_code ?? "",
          p.raw_materials?.name ?? "",
          num(p.quantity).toString(),
          num(p.unit_price).toFixed(2),
          amt.toFixed(2),
        ];
      }),
    ];
    filename = `${vendorId ? "vendor_" : ""}purchases_${from}_to_${to}.csv`;
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
