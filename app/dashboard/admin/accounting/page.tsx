import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import SectionHeader from "../../_components/SectionHeader";
import AccountingExport from "./AccountingExport";

export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Accounting Export</span>
      </div>

      <SectionHeader
        eyebrow="Procure-to-Pay"
        title="Accounting Export"
        description="Hand your purchases and payments to your accountant — export to Tally / Zoho Books without re-keying anything."
      />

      <div className="mt-8 max-w-2xl">
        <AccountingExport />
      </div>
    </div>
  );
}
