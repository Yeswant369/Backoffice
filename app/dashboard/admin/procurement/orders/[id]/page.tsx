import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles, hasAnyRole } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../../../../_components/SectionHeader";
import ReviewPanel, { type PanelLine, type PanelOrder } from "./ReviewPanel";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface OrderRow {
  id: string;
  po_number: string;
  kind: "VENDOR" | "INDENT";
  status: string;
  vendor_id: string | null;
  to_department_id: number | null;
  notes: string | null;
  created_at: string;
  vendors: { name: string; vendor_code: string } | null;
}

interface LineRow {
  id: string;
  raw_material_id: string;
  requested_qty: number;
  approved_qty: number | null;
  fulfilled_qty: number;
  expected_unit_price: number | null;
  raw_materials: { name: string; code: string | null; stock_unit: string } | null;
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Admin, Manager and Store all work this queue (Store dispatches indents);
  // approve/reject stays admin/manager-only via canReview below.
  if (!(await hasAnyRole([1, 2, 3]))) redirect("/dashboard");
  const { roles } = await getCurrentUserAndRoles();
  const canReview = roles.includes(1) || roles.includes(2);
  const { id } = await params;
  const supabase = await createClient();

  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users,
  // so an unpinned lookup could load another outlet's order by pasted UUID.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";
  if (!loc) notFound();

  const [orderRes, linesRes, deptRes] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, vendors ( name, vendor_code )")
      .eq("id", id)
      .eq("location_id", loc)
      .maybeSingle(),
    supabase
      .from("purchase_order_lines")
      .select(
        "id, raw_material_id, requested_qty, approved_qty, fulfilled_qty, expected_unit_price, raw_materials ( name, code, stock_unit )",
      )
      .eq("po_id", id)
      .eq("location_id", loc),
    supabase.from("departments").select("id, name").eq("location_id", loc),
  ]);

  if (!orderRes.data) notFound();
  const order = orderRes.data as unknown as OrderRow;
  const lines = ((linesRes.data ?? []) as unknown as LineRow[]).sort((a, b) =>
    (a.raw_materials?.name ?? "").localeCompare(b.raw_materials?.name ?? ""),
  );

  const departments = (deptRes.data ?? []) as { id: number; name: string }[];
  const deptNames: Record<number, string> = {};
  for (const d of departments) deptNames[d.id] = d.name;

  // For indents, hint what the Store actually holds right now so the reviewer
  // can trim approved quantities before dispatch bounces on INSUFFICIENT.
  const storeStock: Record<string, number> = {};
  if (order.kind === "INDENT" && lines.length > 0) {
    const storeDeptId = departments.find(
      (d) => d.name.trim().toLowerCase() === "store",
    )?.id;
    if (storeDeptId !== undefined) {
      const { data: stock } = await supabase
        .from("live_stock")
        .select("raw_material_id, current_stock")
        .eq("location_id", loc)
        .eq("department_id", storeDeptId)
        .in("raw_material_id", lines.map((l) => l.raw_material_id));
      for (const s of stock ?? []) {
        storeStock[s.raw_material_id as string] = n(s.current_stock);
      }
    }
  }

  const isIndent = order.kind === "INDENT";
  const target = isIndent
    ? `Indent to ${deptNames[order.to_department_id ?? -1] ?? "—"}`
    : `Vendor: ${order.vendors?.name ?? "—"}${order.vendors?.vendor_code ? ` (${order.vendors.vendor_code})` : ""}`;
  const description = [
    order.status,
    `Requested ${formatDate(order.created_at)}`,
    target,
    ...(order.notes ? [order.notes] : []),
  ].join(" · ");

  const panelOrder: PanelOrder = {
    id: order.id,
    po_number: order.po_number,
    kind: order.kind,
    status: order.status,
  };
  const panelLines: PanelLine[] = lines.map((l) => ({
    id: l.id,
    name: l.raw_materials?.name ?? "—",
    code: l.raw_materials?.code ?? null,
    unit: l.raw_materials?.stock_unit ?? "",
    requested_qty: n(l.requested_qty),
    approved_qty: l.approved_qty === null ? null : n(l.approved_qty),
    fulfilled_qty: n(l.fulfilled_qty),
    expected_unit_price:
      l.expected_unit_price === null ? null : n(l.expected_unit_price),
  }));

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link
          href="/dashboard/admin/procurement/orders"
          className="text-indigo-700 transition hover:text-indigo-500"
        >
          Orders &amp; Indents
        </Link>
        <span>/</span>
        <span className="text-neutral-700">{order.po_number}</span>
      </div>

      <SectionHeader
        eyebrow={isIndent ? "Internal Indent" : "Vendor Purchase Order"}
        title={order.po_number}
        description={description}
      />

      <div className="mb-8 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-2">
        <div className="overflow-x-auto rounded-lg border border-[#e6e0d3] bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-2.5 font-medium">Material</th>
                <th className="px-5 py-2.5 text-right font-medium">Requested</th>
                <th className="px-5 py-2.5 text-right font-medium">Approved</th>
                <th className="px-5 py-2.5 text-right font-medium">Fulfilled</th>
                <th className="px-5 py-2.5 text-right font-medium">Expected ₹</th>
                {isIndent && (
                  <th className="px-5 py-2.5 text-right font-medium">Store stock</th>
                )}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={isIndent ? 6 : 5}
                    className="px-5 py-8 text-center text-neutral-500"
                  >
                    No line items on this order.
                  </td>
                </tr>
              ) : (
                lines.map((l) => {
                  const unit = l.raw_materials?.stock_unit ?? "";
                  const avail = storeStock[l.raw_material_id] ?? 0;
                  const short = avail < n(l.approved_qty ?? l.requested_qty);
                  return (
                    <tr key={l.id} className="border-t border-[#e6e0d3]">
                      <td className="px-5 py-2.5 text-neutral-700">
                        <span className="font-medium text-neutral-900">
                          {l.raw_materials?.name ?? "—"}
                        </span>
                        {l.raw_materials?.code && (
                          <span className="ml-2 text-xs text-neutral-500">
                            {l.raw_materials.code}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                        {n(l.requested_qty)} {unit}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                        {l.approved_qty === null ? "—" : `${n(l.approved_qty)} ${unit}`}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                        {n(l.fulfilled_qty)} {unit}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">
                        {l.expected_unit_price === null
                          ? "—"
                          : inr(n(l.expected_unit_price))}
                      </td>
                      {isIndent && (
                        <td
                          className={`px-5 py-2.5 text-right tabular-nums ${
                            short ? "font-semibold text-red-600" : "text-neutral-700"
                          }`}
                        >
                          {avail} {unit}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ReviewPanel
        order={panelOrder}
        lines={panelLines}
        locationId={loc}
        canReview={canReview}
      />
    </div>
  );
}
