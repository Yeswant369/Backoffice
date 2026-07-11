import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasAnyRole } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import SectionHeader from "../../../_components/SectionHeader";
import PoCreateForm from "./PoCreateForm";

export const dynamic = "force-dynamic";

interface OrderRow {
  id: string;
  po_number: string;
  kind: "VENDOR" | "INDENT";
  status: string;
  notes: string | null;
  created_at: string;
  expected_date: string | null;
  vendor_id: string | null;
  to_department_id: number | null;
  reviewed_at: string | null;
  vendors: { name: string } | null;
}

const PO_SELECT =
  "id, po_number, kind, status, notes, created_at, expected_date, vendor_id, to_department_id, reviewed_at, vendors ( name )";

/** ?status= tab → the DB statuses it shows. */
const TABS: { key: string; label: string; statuses: string[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "pending", label: "Pending", statuses: ["PENDING"] },
  { key: "approved", label: "Approved", statuses: ["APPROVED"] },
  { key: "dispatched", label: "Dispatched", statuses: ["DISPATCHED"] },
  { key: "received", label: "Received", statuses: ["RECEIVED"] },
  { key: "closed", label: "Rejected/Cancelled", statuses: ["REJECTED", "CANCELLED"] },
];

const STATUS_CHIP: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-indigo-100 text-indigo-700",
  DISPATCHED: "bg-sky-100 text-sky-700",
  RECEIVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED: "bg-neutral-200 text-neutral-600",
};

/** ISO timestamp `days` days before now (evaluated per request). */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Admin, Manager and Store all work this queue (Store dispatches indents).
  if (!(await hasAnyRole([1, 2, 3]))) redirect("/dashboard");

  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const tab = TABS.find((t) => t.key === (raw ?? "all")) ?? TABS[0];

  const supabase = await createClient();

  // Pin everything to HOME — hybrid Admin+Owner read-scope spans the org.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const since = daysAgoIso(30);

  const [recentRes, openRes, deptRes, vendorsRes, materialsRes] =
    await Promise.all([
      supabase
        .from("purchase_orders")
        .select(PO_SELECT)
        .eq("location_id", loc)
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      supabase
        .from("purchase_orders")
        .select(PO_SELECT)
        .eq("location_id", loc)
        .in("status", ["PENDING", "APPROVED"])
        .order("created_at", { ascending: false }),
      supabase.from("departments").select("id, name").eq("location_id", loc),
      supabase
        .from("vendors")
        .select("id, name, vendor_code")
        .eq("location_id", loc)
        .eq("approved", true)
        .order("name"),
      supabase
        .from("raw_materials")
        .select("id, name, code, stock_unit")
        .eq("location_id", loc)
        .order("name"),
    ]);

  const loadError =
    recentRes.error || openRes.error || deptRes.error || vendorsRes.error || materialsRes.error;

  // Merge the two windows (last 30 days ∪ still-open), dedupe by id.
  const byId = new Map<string, OrderRow>();
  for (const row of [
    ...((recentRes.data ?? []) as unknown as OrderRow[]),
    ...((openRes.data ?? []) as unknown as OrderRow[]),
  ]) {
    byId.set(row.id, row);
  }
  const orders = [...byId.values()].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  const departments = (deptRes.data ?? []) as { id: number; name: string }[];
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  // Line counts, aggregated client-side.
  const lineCount = new Map<string, number>();
  if (orders.length > 0) {
    const { data: lines } = await supabase
      .from("purchase_order_lines")
      .select("po_id")
      .eq("location_id", loc)
      .in("po_id", orders.map((o) => o.id));
    for (const l of (lines ?? []) as { po_id: string }[]) {
      lineCount.set(l.po_id, (lineCount.get(l.po_id) ?? 0) + 1);
    }
  }

  const visible = tab.statuses
    ? orders.filter((o) => tab.statuses!.includes(o.status))
    : orders;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Orders &amp; Indents</span>
      </div>

      <SectionHeader
        eyebrow="Procure-to-Pay"
        title="Orders & Indents"
        description="Vendor purchase orders and internal indent requests — raise, review, and track them from request to receipt or dispatch."
      />

      {loadError && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load some data: {loadError.message}. Confirm the purchase-order
          migration has been applied.
        </p>
      )}

      <div className="mb-6 inline-flex gap-1 rounded-lg bg-[#efe9dd] p-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "?" : `?status=${t.key}`}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              t.key === tab.key
                ? "bg-white text-neutral-950 shadow-sm"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No {tab.key === "all" ? "" : `${tab.label.toLowerCase()} `}orders in the
            last 30 days.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-5 py-3 font-medium">Kind</th>
                <th className="px-5 py-3 font-medium">Vendor / Department</th>
                <th className="px-5 py-3 text-right font-medium">Lines</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Requested</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr
                  key={o.id}
                  className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                >
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/dashboard/admin/procurement/orders/${o.id}`}
                      className="font-mono text-xs font-semibold text-indigo-700 transition hover:text-indigo-500"
                    >
                      {o.po_number}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        o.kind === "VENDOR"
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {o.kind === "VENDOR" ? "Vendor" : "Indent"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-700">
                    {o.kind === "VENDOR"
                      ? (o.vendors?.name ?? "—")
                      : (deptName.get(o.to_department_id ?? -1) ?? "—")}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                    {lineCount.get(o.id) ?? 0}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        STATUS_CHIP[o.status] ?? "bg-neutral-200 text-neutral-600"
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-700">
                    {formatDate(o.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-8">
        <PoCreateForm
          vendors={(vendorsRes.data ?? []) as { id: string; name: string; vendor_code: string }[]}
          departments={departments}
          materials={(materialsRes.data ?? []) as { id: string; name: string; code: string | null; stock_unit: string }[]}
        />
      </div>
    </div>
  );
}
