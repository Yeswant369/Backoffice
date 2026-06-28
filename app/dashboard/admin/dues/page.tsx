import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import DueForm from "./DueForm";
import SettleControl from "./SettleControl";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface DueRow {
  id: string;
  date_created: string;
  person_name: string;
  amount: number;
  reason: string | null;
  settled_amount: number;
  outstanding: number;
  status: "PENDING" | "PARTIAL" | "SETTLED";
  days_pending: number | null;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-red-50 text-red-700",
  PARTIAL: "bg-amber-50 text-amber-700",
  SETTLED: "bg-emerald-50 text-emerald-700",
};

export default async function DuesPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  // Pin to HOME so the screen (and the totals below) match the synced sheet —
  // RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const { data, error } = await supabase
    .from("dues_tracker")
    .select(
      "id, date_created, person_name, amount, reason, settled_amount, outstanding, status, days_pending",
    )
    .eq("location_id", (home as string | null) ?? "")
    .order("date_created", { ascending: false });
  const rows = (data ?? []) as DueRow[];
  const totalOutstanding = rows.reduce((s, r) => s + n(r.outstanding), 0);
  const openCount = rows.filter((r) => r.status !== "SETTLED").length;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Dues Tracker</span>
      </div>

      <SectionHeader
        eyebrow="Operations"
        title="Dues Tracker"
        description="Money owed TO the restaurant — staff advances and IOUs. Outstanding, status and days-pending are computed automatically and mirror to the Dues Tracker sheet."
      />

      {error && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Couldn&apos;t load dues: {error.message}. Confirm migration 0020 has been
          applied.
        </p>
      )}

      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">Outstanding </span>
          <span className="font-semibold text-neutral-900">{inr(totalOutstanding)}</span>
        </div>
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">Open dues </span>
          <span className="font-semibold text-neutral-900">{openCount}</span>
        </div>
      </div>

      <div className="mb-8">
        <DueForm />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-500">
            No dues recorded.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Person</th>
                <th className="px-5 py-3 font-medium">Reason</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 text-right font-medium">Settled</th>
                <th className="px-5 py-3 text-right font-medium">Outstanding</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Days</th>
                <th className="px-5 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[#e6e0d3] transition hover:bg-[#faf7f1]"
                >
                  <td className="px-5 py-3.5 text-neutral-700">
                    {formatDate(r.date_created)}
                  </td>
                  <td className="px-5 py-3.5 font-medium text-neutral-900">
                    {r.person_name}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">{r.reason ?? "—"}</td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                    {inr(r.amount)}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                    {inr(r.settled_amount)}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-neutral-900">
                    {inr(r.outstanding)}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        STATUS_STYLE[r.status] ?? "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-600">
                    {r.days_pending == null ? "—" : `${r.days_pending}d`}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {r.status === "SETTLED" ? (
                      <span className="text-xs text-neutral-400">—</span>
                    ) : (
                      <SettleControl id={r.id} outstanding={n(r.outstanding)} />
                    )}
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
