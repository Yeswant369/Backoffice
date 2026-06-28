import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { inr, formatDate } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import PettyCashForm from "./PettyCashForm";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

interface ExpenseRow {
  id: string;
  amount: number;
  category: string;
  description: string | null;
  date: string;
}

export default async function PettyCashPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const { data } = await supabase
    .from("petty_cash_expenses")
    .select("id, amount, category, description, date")
    .eq("location_id", loc)
    .order("date", { ascending: false })
    .limit(25);
  const rows = (data ?? []) as ExpenseRow[];
  const total = rows.reduce((s, r) => s + n(r.amount), 0);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Petty Cash</span>
      </div>

      <SectionHeader
        eyebrow="Operations"
        title="Petty Cash"
        description="Log day-to-day cash expenses. Each entry mirrors to the Petty Cash sheet automatically."
      />

      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-5 py-3">
          <span className="text-neutral-500">Recent spend </span>
          <span className="font-semibold text-neutral-900">{inr(total)}</span>
        </div>
      </div>

      <div className="mb-8">
        <PettyCashForm />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6e0d3] bg-[#f7f3ec]">
        <div className="border-b border-[#e6e0d3] px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Recent expenses</h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No expenses logged yet.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[#e6e0d3]">
                  <td className="px-5 py-3.5 text-neutral-700">{formatDate(r.date)}</td>
                  <td className="px-5 py-3.5 text-neutral-700">{r.category}</td>
                  <td className="px-5 py-3.5 text-neutral-600">{r.description ?? "—"}</td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-neutral-900">
                    {inr(r.amount)}
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
