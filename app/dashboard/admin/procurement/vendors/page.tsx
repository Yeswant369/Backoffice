import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import SectionHeader from "../../../_components/SectionHeader";
import VendorCreateSlideOver from "./VendorCreateSlideOver";
import ApproveVendorButton from "./ApproveVendorButton";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface VendorRow {
  id: string;
  vendor_code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  status: string;
  outstanding: number;
  total_paid_mtd: number;
}

export default async function ProcurementVendorsPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();

  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users, so
  // this keeps the screen consistent with what mirrors to the sheet (home only).
  // vendor_master = vendors + auto stats (outstanding, paid MTD) — nothing typed.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";
  const [{ data }, { data: appr }] = await Promise.all([
    supabase
      .from("vendor_master")
      .select(
        "id, vendor_code, name, contact_person, phone, status, outstanding, total_paid_mtd",
      )
      .eq("location_id", loc)
      .order("name"),
    supabase.from("vendors").select("id, approved").eq("location_id", loc),
  ]);
  const vendors = (data ?? []) as VendorRow[];
  // Approval status ("fixed unless added & approved") merged in by id.
  const approvedMap = new Map(
    (appr ?? []).map((a) => [a.id as string, a.approved as boolean]),
  );

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Vendor Hub</span>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <SectionHeader
          eyebrow="Procure-to-Pay"
          title="Vendor Hub"
          description="Manage suppliers. New vendors mirror to the Vendor Master sheet automatically; outstanding and paid-to-date are computed live."
        />
        <VendorCreateSlideOver />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">
            Vendors <span className="ml-1 text-neutral-500">{vendors.length}</span>
          </h2>
        </div>
        {vendors.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No vendors yet. Create your first supplier.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Contact</th>
                <th className="px-5 py-3 text-right font-medium">Paid (MTD)</th>
                <th className="px-5 py-3 text-right font-medium">Outstanding</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Approval</th>
                <th className="px-5 py-3 text-right font-medium">Profile</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr
                  key={v.id}
                  className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                >
                  <td className="px-5 py-3.5 font-mono text-xs text-neutral-600">
                    {v.vendor_code}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/dashboard/admin/procurement/vendors/${v.id}`}
                      className="font-medium text-indigo-700 transition hover:text-indigo-500"
                    >
                      {v.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">
                    {v.contact_person ?? "—"}
                    {v.phone && (
                      <span className="block text-[11px] text-neutral-500">
                        {v.phone}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                    {inr(v.total_paid_mtd)}
                  </td>
                  <td
                    className={`px-5 py-3.5 text-right font-semibold tabular-nums ${
                      n(v.outstanding) > 0 ? "text-red-600" : "text-neutral-500"
                    }`}
                  >
                    {inr(v.outstanding)}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-[11px] uppercase tracking-wider text-neutral-600">
                      {v.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {approvedMap.get(v.id) === false ? (
                      <span className="flex items-center gap-2">
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          Pending
                        </span>
                        <ApproveVendorButton id={v.id} />
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-emerald-600">
                        Approved
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Link
                      href={`/dashboard/admin/procurement/vendors/${v.id}`}
                      className="rounded-lg border border-[#e6e0d3] px-3 py-1.5 text-xs text-neutral-700 transition hover:border-[#cdc4b1] hover:text-neutral-900"
                    >
                      View
                    </Link>
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
