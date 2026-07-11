import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { toCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const day = (v: unknown) => String(v ?? "").slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);

const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/**
 * Page through a PostgREST query — an un-ranged select is silently capped at
 * ~1000 rows. Accumulates 1000-row pages until a short page; hard-capped at
 * MAX_PAGES so a runaway range can't stall the export (truncated=true then).
 */
async function fetchAllPages<T>(
  makeQuery: (lo: number, hi: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<{ rows: T[]; truncated: boolean } | { error: string }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const lo = page * PAGE_SIZE;
    const { data, error } = await makeQuery(lo, lo + PAGE_SIZE - 1);
    if (error) return { error: error.message };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/**
 * Export POS reports as CSV. Admin-only, pinned to the caller's home location.
 * ?type=pos_daily|pos_items, ?from=YYYY-MM-DD&to=YYYY-MM-DD
 * (default: last 90 days → today, IST).
 */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "pos_items" ? "pos_items" : "pos_daily";
  const todayIST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const ninetyAgo = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })
    .format(new Date(Date.now() - 90 * 86400000));
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : ninetyAgo;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : todayIST;

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

  if (type === "pos_items") {
    const res = await fetchAllPages<{
      order_date: string;
      item_name: string | null;
      category: string | null;
      qty_sold: number;
      revenue: number;
      food_cost: number;
      gross_profit: number;
    }>((lo, hi) =>
      supabase
        .from("pos_item_report")
        .select("order_date, item_name, category, qty_sold, revenue, food_cost, gross_profit")
        .eq("location_id", loc)
        .gte("order_date", from)
        .lte("order_date", to)
        .order("order_date")
        .range(lo, hi),
    );
    if ("error" in res)
      return NextResponse.json({ error: res.error }, { status: 500 });
    rows = [
      ["Day", "Item", "Category", "Qty", "Revenue", "Food Cost", "Gross Profit"],
      ...res.rows.map((r) => [
        day(r.order_date),
        r.item_name ?? "",
        r.category ?? "",
        num(r.qty_sold).toString(),
        num(r.revenue).toFixed(2),
        num(r.food_cost).toFixed(2),
        num(r.gross_profit).toFixed(2),
      ]),
    ];
    if (res.truncated) rows.push(["TRUNCATED — narrow the date range"]);
    filename = `pos_items_${from}_to_${to}.csv`;
  } else {
    const res = await fetchAllPages<{
      order_date: string;
      orders: number;
      gross: number;
      discount: number;
      gst: number;
      net: number;
    }>((lo, hi) =>
      supabase
        .from("pos_daily_sales")
        .select("order_date, orders, gross, discount, gst, net")
        .eq("location_id", loc)
        .gte("order_date", from)
        .lte("order_date", to)
        .order("order_date")
        .range(lo, hi),
    );
    if ("error" in res)
      return NextResponse.json({ error: res.error }, { status: 500 });
    rows = [
      ["Day", "Orders", "Gross", "Discount", "GST", "Net"],
      ...res.rows.map((r) => [
        day(r.order_date),
        num(r.orders).toString(),
        num(r.gross).toFixed(2),
        num(r.discount).toFixed(2),
        num(r.gst).toFixed(2),
        num(r.net).toFixed(2),
      ]),
    ];
    if (res.truncated) rows.push(["TRUNCATED — narrow the date range"]);
    filename = `pos_daily_${from}_to_${to}.csv`;
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
